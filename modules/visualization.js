import * as d3 from 'd3';
import {
    paddingLeft, fadeEnd, fadeBottomHeight, DOUBLE_CLICK_THRESHOLD, paddingBottom,
    DEBUG_SHOW_BOUNDS, FADE_OPACITY, INEQUALITY_ARROW_LENGTH_FACTOR, ZOOM_NEIGHBOR_DISTANCE_PX,
    checkMobile, checkTouch
} from './constants.js';

import { getDimensionValueY, getDimensionValueX, getLocalized, getFilteredData, parseValue, getLabelWithIsotopeOverride } from './utils.js';
import { setupItemAnnotations, updateAnnotationLayout } from './annotations.js';
import { createRuler } from './ruler.js';
import { createSvgLayers } from './svgSetup.js';
import { createGrid } from './grid.js';
import { createLegend } from './legend.js';
import { getClusters } from './grouping.js';

// Helper to calculate visual extents for a point
function computePointVisuals(d, xScale, yScale, currentDimensionX, currentDimensionY, precisionFS) {
    const px = xScale(d._cachedX);
    const rawY = d.dimensions ? d.dimensions[currentDimensionY] : undefined;
    let v1 = d._cachedY;
    let v2 = d._cachedY;
    let isRange = Array.isArray(rawY);
    let yType = "equal";
    if (isRange) {
        yType = "range";
        v2 = Number(rawY[1]);
    } else if (typeof rawY === 'string') {
        if (rawY.startsWith('>')) yType = 'greater';
        else if (rawY.startsWith('<')) yType = 'less';
    }

    const py1 = yScale(v1);

    if (!Number.isFinite(px) || !Number.isFinite(py1)) return null;

    // Calculate Screen Extents (at fs=12)
    let l = 0, r = 0, u = 0, dExt = 0;
    let lc = 0, ls = 0, rc = 0, rs = 0, uc = 0, us = 0, dc = 0, ds = 0;

    if (yType === 'range') {
        const py2 = yScale(v2);
        const rangeFS = precisionFS * 1.75;
        const radius = precisionFS / 2.4;
        const thickness = 0.75 * radius;

        const textLen = ((d._estTextWidth || 0) * rangeFS) + 6;
        const midY = (py1 + py2) / 2;

        const diff = Math.abs(py1 - py2) / 2;
        const halfLen = textLen / 2;

        uc = diff; us = halfLen;
        dc = diff; ds = halfLen;

        const labelHalfWidth = (rangeFS * 1.5) / 2;
        // lc = 20. ls = thick + halfW
        lc = 20;
        ls = thickness + labelHalfWidth;

        // r = thickness / 2.
        rc = thickness / 2; rs = 0;

        l = lc + ls; r = rc + rs; u = uc + us; dExt = dc + ds;

        return { x: px, y: midY, l, r, u, d: dExt, lc, ls, rc, rs, uc, us, dc, ds };
    } else {
        const radius = precisionFS / 2.4;
        const labelGap = 10;
        // l = radius (S)
        lc = 0; ls = radius;

        // r = 10 (C) + text (S)
        rc = 10;
        rs = (d._estTextWidth || 0) * precisionFS + radius;

        l = ls; // lc=0
        r = rc + rs;

        let yUp = radius;
        let yDown = radius;

        // Label vertical
        yUp = Math.max(yUp, precisionFS * 0.7);
        yDown = Math.max(yDown, precisionFS * 0.8);

        if (currentDimensionX === "none") {
            const arrowLen = INEQUALITY_ARROW_LENGTH_FACTOR * radius;
            if (yType === 'greater') yUp = Math.max(yUp, arrowLen);
            else if (yType === 'less') yDown = Math.max(yDown, arrowLen);
        }

        uc = 0; us = yUp;
        dc = 0; ds = yDown;
        u = yUp; dExt = yDown;

        return { x: px, y: py1, l, r, u: yUp, d: yDown, lc, ls, rc, rs, uc, us, dc, ds };
    }
}

export function createVisualization(container, config) {
    let width = container.clientWidth;
    let height = container.clientHeight;
    const initialConfig = config || {};
    let currentDimensionX = initialConfig.currentDimensionX || "none";
    let currentDimensionY = initialConfig.currentDimensionY || "length";
    let prevDimensionX = null;
    let prevDimensionY = null;
    let paddingRight = 50;
    let isInitialLoad = true;
    let callbacks = {};

    // Transition State
    let prevXScale = null;
    let prevYScale = null;
    let transitionStartTime = 0;
    let isTransitioning = false;
    let transitionDuration = 750;
    let transitionExitingItems = [];
    let prevTransform = null;
    let transitionPrevDimX = null;
    let transitionPrevDimY = null;


    // SVG setup (gradients, masks, layer groups)
    const {
        svg, gridGroup, xLabelGroup, yLabelGroup, mobileMask,
        dataLayerOuter, g, gCombined, updateMask
    } = createSvgLayers(container, width, height);

    // checkMobile imported from constants.js

    updateMask(width, height, currentDimensionX, checkMobile());

    const ruler = createRuler(svg, checkTouch);
    const grid = createGrid(gridGroup, xLabelGroup, yLabelGroup, mobileMask);
    const legend = createLegend(svg, g, gCombined);

    // Scales
    let yScale = d3.scaleLog().range([height - 50, 50]);
    let xScale = d3.scaleLinear();

    // Zoom Setup
    let minZoom = 1;
    const zoom = d3.zoom()
        .scaleExtent([minZoom, 1000000])
        .filter((event) => {
            // Prevent zoom on right-click (button === 2)
            if (event.button === 2) return false;
            return !ruler.isDragging;
        })
        .on('zoom', (event) => {
            handleZoom(event);
        });

    // Global state accessible to zoom handler
    let currentState = {
        colorScale: null,
        language: 'en-us',
        data: [],
        filteredData: [], // Pre-computed filtered data
        clusters: [], // Computed clusters
        hiddenIds: new Set(), // IDs of items that should be hidden because they are in a cluster
        layoutVersion: 0 // Incremented when dimensions/data layout changes
    };

    function getDynamicBounds(k) {
        if (!currentState.boundsHulls) return null;
        const { minX, maxX, minY, maxY, baseDecadeHeight } = currentState.boundsHulls;

        // visual_fs = min(12, baseDecadeHeight * k) but enforce min 4px
        const baseFS = baseDecadeHeight * k;
        const visualFS = Math.max(4, Math.min(12, baseFS));
        const scalingFactorS = visualFS / (12 * k); // Scalable part (text, radius)
        const scalingFactorC = 1 / k; // Constant part (fixed screen pixel offsets)

        const getBound = (list, sign, keyPos, keyExt) => {
            let best = (sign < 0) ? Infinity : -Infinity;
            for (const p of list) {
                // Split extent into constant and scalable components
                const extC = p[keyExt + 'c'] || 0;
                const extS = p[keyExt + 's'] || p[keyExt] || 0; // Fallback to full extent as scalable if split missing

                const worldExt = (extC * scalingFactorC) + (extS * scalingFactorS);
                const val = p[keyPos] + (sign * worldExt);
                if (sign < 0) best = Math.min(best, val);
                else best = Math.max(best, val);
            }
            return best;
        };

        if (!minX || minX.length === 0) return null;

        return {
            minX: getBound(minX, -1, 'x', 'l'),
            maxX: getBound(maxX, 1, 'x', 'r'),
            minY: getBound(minY, -1, 'y', 'u'),
            maxY: getBound(maxY, 1, 'y', 'd')
        };
    }

    /**
     * Core Render Loop
     * Renders items and clusters that are visible within the current view.
     */
    function render(t, event) {
        // 1. Rescale Scales
        const newXScale = t.rescaleX(xScale);
        const newYScale = t.rescaleY(yScale);

        // Transition Logic
        let renderXScale = newXScale;
        let renderYScale = newYScale;
        let useStandardRender = true;
        let p = 1;

        if (isTransitioning) {
            const now = Date.now();
            const elapsed = now - transitionStartTime;
            const progress = Math.min(1, elapsed / transitionDuration);

            // Match d3.transition() default easing (cubic-in-out)
            p = d3.easeCubicInOut(progress);

            if (p < 1) {
                useStandardRender = false;
                // We need to interpolate between (prevXScale(d._prevX)) and (newXScale(d._cachedX))
                // effectively:
                // oldScreenX = t_zoom.applyX(prevXScale(d._prevX)) ?? No.
                // The zoom transform 't' changes DURING transition (due to resetZoom calling zoom.transform).
                // So 't' is the CURRENT zoom state.
                // We want the point to move from [OldWorld -> OldScreen] to [NewWorld -> NewScreen]
                // But wait, the 'resetZoom' animation moves the Camera (t).
                // The points themselves change World Coordinates (xScale / yScale definitions change).
                //
                // If we use `newXScale` (which comes from `t.rescaleX(xScale)`), it represents "Current World projected to Screen".
                // `xScale` is the NEW base scale.
                // `prevXScale` was the OLD base scale.
                //
                // We want d to slide from `prevXScale(d._prevX)` to `xScale(d._cachedX)` in BASE PIXELS?
                // Then apply `t`?
                // Yes, because `t` is applied via `t.rescaleX`.
                // RescaleX roughly means: domain is same, range is t-transformed.
                // Actually `t.rescaleX(s)` returns a scale where `s'(x) = t.applyX(s(x))`.
                //
                // So, interpolatedBaseX = prevXScale(d._prevX) * (1-p) + xScale(d._cachedX) * p.
                // finalScreenX = t.applyX(interpolatedBaseX).
                //
                // HOWEVER, prevXScale might be log and xScale linear (or vice versa).
                // prevXScale(val) returns the pixel value in the OLD "World" (base zoom).
                // So we interpolate in PIXEL space (World Pixels). Good.

                // Override scales is hard because we need per-point interpolation.
                // We will handle this in the Enter/Update logic below by modifying the transform function.
            } else {
                isTransitioning = false;
                prevXScale = null;
                prevYScale = null;
                prevTransform = null;
            }
        }




        // 2. Update Grid
        grid.updateGrid(t, { width, height, xScale, yScale, currentDimensionX, currentDimensionY, isMobile: checkMobile() });

        // 3. Viewport Culling Calculation (Extreme: O(log N))
        const buffer = 300; // pixels
        const visibleYInverted = [newYScale.invert(height + buffer), newYScale.invert(-buffer)];
        const yMin = Math.min(visibleYInverted[0], visibleYInverted[1]);
        const yMax = Math.max(visibleYInverted[0], visibleYInverted[1]);

        const visibleXInverted = [newXScale.invert(-buffer), newXScale.invert(width + buffer)];
        const xMin = Math.min(visibleXInverted[0], visibleXInverted[1]);
        const xMax = Math.max(visibleXInverted[0], visibleXInverted[1]);

        // Helper for binary search
        const bisector = d3.bisector(d => d._cachedY).left;

        const getVisibleSubset = (data) => {
            if (data.length === 0) return [];
            // Linear filter since data is no longer sorted by Y
            return data.filter(d =>
                d._cachedY >= yMin && d._cachedY <= yMax &&
                d._cachedX >= xMin && d._cachedX <= xMax
            );
        };

        if (currentState.lastClickId === undefined) {
            currentState.lastClickId = null;
            currentState.lastClickTime = 0;
        }

        // --- Data Filtering based on Axis ---
        const visibleDataSubset = getVisibleSubset(currentState.filteredData);
        const visibleClustersSubset = getVisibleSubset(currentState.clusters);

        // 5. Proximity Hiding (Greedy Selection)
        // Hide points that are too close to *already visible* points.
        const ppd = Math.abs(newYScale(10) - newYScale(1));
        const minPixelDist = 5; // Reduced from 20 to allows more points
        const minDistDecades = minPixelDist / ppd;

        // Quadtree for currently rendered points (in log/linear-log space)
        const visibleQuad = d3.quadtree()
            .x(d => (currentDimensionX === "none") ? d._cachedX : Math.log10(d._cachedX))
            .y(d => Math.log10(d._cachedY));

        const greedyFilter = (list) => {
            // Sort by stable priority index so higher priority items are placed first
            // This ensures that if A and B are close, A (higher priority) always wins and B is hidden.
            const sorted = [...list].sort((a, b) => a._priorityIndex - b._priorityIndex);

            const result = [];
            sorted.forEach(d => {
                const x = (currentDimensionX === "none") ? d._cachedX : Math.log10(d._cachedX);
                const y = Math.log10(d._cachedY);

                // Range items should NEVER be hidden by proximity
                // Check original dimension value for array (range)
                // Note: 'd' might be a cluster or a single item.
                // Single item: d.dimensions[dim]
                // Cluster: d.dimensions[dim] (inherited from first member)
                const rawDimY = d.dimensions ? d.dimensions[currentDimensionY] : undefined;
                const isRange = Array.isArray(rawDimY);

                if (isRange) {
                    // Always show range items
                    // Add to quadtree so they can act as blockers for other items
                    visibleQuad.add(d);
                    result.push(d);
                    return;
                }

                // Check if any *already placed* point is too close
                const nearest = visibleQuad.find(x, y, minDistDecades);
                if (!nearest) {
                    // No conflict, place it
                    visibleQuad.add(d);
                    result.push(d);
                }
            });
            return result;
        };

        // Combine lists? No, we probably want to prioritize clusters over single items?
        // Or process them independently? 
        // If a cluster and a single item are close, who wins?
        // Let's process them as one group to prevent overlap between clusters and items?
        // Or keep separate?
        // Original logic filtered them separately. Let's keep separate for now to minimize change,
        // but typically you'd want a shared quadtree.
        // Actually, if we use a shared `visibleQuad`, they will cull each other! 
        // Let's use the shared `visibleQuad` defined above for both.

        // Prioritize clusters first (usually more important aggregate info)
        let visibleClusters, visibleData;

        if (checkMobile()) {
            visibleClusters = greedyFilter(visibleClustersSubset);
            visibleData = greedyFilter(visibleDataSubset);
        } else {
            visibleClusters = visibleClustersSubset;
            visibleData = visibleDataSubset;
        }

        // 5. Rendering Constants
        const currentDecadeHeight = Math.abs(newYScale(10) - newYScale(1));
        const currentFS = Math.min(12, currentDecadeHeight);
        const currentRadius = currentFS / 2.4;

        // Dynamically cap max zoom: prevent zooming in when nothing is visible
        const hasVisibleItems = visibleData.length > 0 || visibleClusters.length > 0;
        const maxZoom = hasVisibleItems ? 1000000 : t.k;
        zoom.scaleExtent([minZoom, maxZoom]);

        // Transition: Fade Exiting Items
        let renderData = visibleData;
        if (isTransitioning && transitionExitingItems.length > 0) {
            renderData = renderData.concat(transitionExitingItems);
        }


        // 6. Join & Render - Individual Items (g)
        g.selectAll('.item-group').data(renderData, d => d.id)
            .join(
                enter => {
                    const grp = enter.append('g').attr('class', 'item-group');
                    grp.append('rect').attr('class', 'hit-area').attr('fill', 'transparent').style('cursor', 'pointer');
                    grp.append('rect').attr('class', 'label-bg').attr('rx', 4).attr('ry', 4).attr('fill', 'black').attr('opacity', 0);
                    grp.append('rect').attr('class', 'inequality-rect').style('cursor', 'pointer').attr('opacity', 0);
                    grp.append('line').attr('class', 'range-line').style('cursor', 'pointer').attr('opacity', 0);
                    grp.append('circle').attr('cx', 0).attr('cy', 0);
                    grp.append('text').attr('class', 'label').attr('x', 10).attr('y', 0).attr('dy', '.35em')
                        .style('font-family', 'monospace').style('font-weight', 'bold');

                    // Setup Annotations for new items
                    setupItemAnnotations(grp, {
                        currentDimensionX, currentDimensionY,
                        colorScale: currentState.colorScale,
                        language: currentState.language
                    });
                    grp.each(function () { this._layoutVersion = currentState.layoutVersion; });

                    grp.on("click", (event, d) => {
                        const now = new Date().getTime();
                        const isDoubleClick = (d.id === currentState.lastClickId) && ((now - currentState.lastClickTime) < DOUBLE_CLICK_THRESHOLD);


                        currentState.lastClickId = d.id;
                        currentState.lastClickTime = now;

                        ruler.update({
                            width, height, currentDimensionX, currentDimensionY,
                            xScale: d3.zoomTransform(svg.node()).rescaleX(xScale),
                            yScale: d3.zoomTransform(svg.node()).rescaleY(yScale)
                        });

                        // Always trigger click (highlight)
                        if (callbacks.onClick) callbacks.onClick(event, d);

                        if (isDoubleClick) {
                            if (callbacks.onDblClick) callbacks.onDblClick(event, d);
                            // Reset to prevent triple-click triggering another double-click
                            currentState.lastClickId = null;
                            currentState.lastClickTime = 0;
                        }
                        event.stopPropagation();
                    });

                    return grp;
                },
                update => update,
                exit => exit.remove()
            )
            .attr('transform', d => {
                let x, y;

                if (!useStandardRender && d._prevX !== undefined && d._prevX !== null && prevXScale && prevYScale) {


                    if (d._isExiting) {
                        // Fade Out at OLD world position, but view (t) might have jumped.
                        // To keep it smooth, we interpolate its screen position:
                        // Start: exactly where it was (prevTransform + prevScale)
                        // End: where it SHOULD be in the new world context if it stayed at its old world pos?
                        // If it's exiting, it's NOT in the new world. 
                        // We want it to "stick" to its old screen spot and then move with the NEW camera.

                        const oldScreenX = prevTransform.applyX(prevXScale(d._prevX));
                        const oldScreenY = prevTransform.applyY(prevYScale(d._prevY));

                        const newScreenX = t.applyX(prevXScale(d._prevX));
                        const newScreenY = t.applyY(prevYScale(d._prevY));

                        x = oldScreenX + (newScreenX - oldScreenX) * p;
                        y = oldScreenY + (newScreenY - oldScreenY) * p;

                    } else {
                        // Persistent or Entering Item
                        // For Persistent:
                        // Start: prevTransform.applyX(prevXScale(d._prevX))
                        // End: t.applyX(xScale(d._cachedX))

                        // For Entering (d._prevX is undefined):
                        // Start: prevTransform.applyX(xScale(d._cachedX)) 
                        // End: t.applyX(xScale(d._cachedX))

                        let oldX, oldY;
                        if (d._prevX !== undefined && d._prevX !== null) {
                            oldX = prevTransform.applyX(prevXScale(d._prevX));
                            oldY = prevTransform.applyY(prevYScale(d._prevY));
                        } else {
                            oldX = prevTransform.applyX(xScale(d._cachedX));
                            oldY = prevTransform.applyY(yScale(d._cachedY));
                        }

                        const newX = t.applyX(xScale(d._cachedX));
                        const newY = t.applyY(yScale(d._cachedY));

                        if (Number.isFinite(oldX) && Number.isFinite(newX)) {
                            x = oldX + (newX - oldX) * p;
                        } else {
                            x = newX;
                        }

                        if (Number.isFinite(oldY) && Number.isFinite(newY)) {
                            y = oldY + (newY - oldY) * p;
                        } else {
                            y = newY;
                        }
                    }

                } else {
                    x = newXScale(d._cachedX);
                    y = newYScale(d._cachedY);
                }
                return `translate(${x}, ${y})`;
            })
            .style('opacity', d => {
                if (currentState.hiddenIds.has(d.id)) return 0;
                if (isTransitioning) {
                    if (d._isExiting) return 1 - p;
                    // Robust check for "new" items: if no finite previous coordinate, it's new
                    const isNew = !Number.isFinite(d._prevX) || !Number.isFinite(d._prevY);
                    if (isNew) return p;
                }
                return null; // Default opacity (1)
            })
            .style('pointer-events', d => currentState.hiddenIds.has(d.id) ? 'none' : null);


        // Update annotation setup for existing items if layout changed (e.g. dimensions flipped)
        // Optimization: Only run this on the subset that needs it. 
        // We do this via .each check.
        const itemSelection = g.selectAll('.item-group');
        itemSelection.each(function (d) {
            if (this._layoutVersion !== currentState.layoutVersion) {
                // If item is exiting, use dimensions from where it came from to avoid layout jump
                const setupDimX = d._isExiting ? transitionPrevDimX : currentDimensionX;
                const setupDimY = d._isExiting ? transitionPrevDimY : currentDimensionY;

                setupItemAnnotations(d3.select(this), {
                    currentDimensionX: setupDimX,
                    currentDimensionY: setupDimY,
                    colorScale: currentState.colorScale,
                    language: currentState.language
                });
                this._layoutVersion = currentState.layoutVersion;
            }
        });

        // Update Dynamic Layout (Scale/Radius dependent)
        itemSelection.select('circle').attr('r', currentRadius);

        const prevScreenYScale = (isTransitioning && prevTransform && prevYScale) ? prevTransform.rescaleY(prevYScale) : null;
        updateAnnotationLayout(itemSelection, currentRadius, currentFS, newYScale, prevScreenYScale, p);



        // 7. Join & Render - Groups/Clusters (gCombined)
        gCombined.selectAll('.item-group.combined').data(visibleClusters, d => d.id)
            .join(
                enter => {
                    const grp = enter.append("g")
                        .attr("class", "item-group combined");

                    grp.append('rect').attr('class', 'hit-area')
                        .attr('fill', 'transparent').style('cursor', 'pointer');

                    grp.append('rect').attr('class', 'label-bg')
                        .attr('rx', 4).attr('ry', 4).attr('fill', 'black').attr('opacity', 0);

                    grp.append('rect').attr('class', 'inequality-rect').style('cursor', 'pointer').attr('opacity', 0);

                    grp.append('circle').attr('cx', 0).attr('cy', 0);

                    const textEl = grp.append('text').attr('class', 'label').attr('x', 10).attr('y', 0).attr('dy', '.35em')
                        .style('font-family', 'monospace').style('font-weight', 'bold');


                    // Build tspans ONCE on enter using pre-calculated groups
                    grp.each(function (d) {
                        const el = d3.select(this);
                        const textEl = el.select('.label');

                        // Use members determined by grouping.js to fit in limit
                        if (d._labelMembers) {
                            const isMassOrDuration = currentDimensionX === "mass" || currentDimensionX === "duration" ||
                                currentDimensionY === "mass" || currentDimensionY === "duration";

                            d._labelMembers.forEach((m, i) => {
                                let name = getLocalized(m.displayName, currentState.language);
                                const tags = (m.tags && m.tags[currentState.language]) || [];
                                name = getLabelWithIsotopeOverride(name, tags, currentDimensionX, currentDimensionY);

                                const cat = getLocalized(m.category, currentState.language);
                                textEl.append('tspan').text(name).attr('fill', currentState.colorScale(cat));

                                if (i < d._labelMembers.length - 1) {
                                    // Use separator styling
                                    textEl.append('tspan').text(' / ').attr('fill', currentState.colorScale(cat));
                                }
                            });

                            if (d._hiddenCount > 0) {
                                textEl.append('tspan').text(` (+ ${d._hiddenCount} ${d._hiddenCount === 1 ? 'other' : 'others'})`).attr('fill', '#888');
                            }
                        } else {
                            // Fallback for safety (though _labelMembers should always exist)
                            let name = getLocalized(d.displayName, currentState.language);
                            const m = d._members ? d._members[0] : d;
                            const tags = (m.tags && m.tags[currentState.language]) || [];
                            name = getLabelWithIsotopeOverride(name, tags, currentDimensionX, currentDimensionY);
                            textEl.text(name);
                        }

                        // Set initial circle color
                        el.select('circle')
                            .attr('fill', currentState.colorScale(getLocalized(d._members[0].category, currentState.language)));
                    });

                    // Setup Annotations for new clusters (mostly just default behavior)
                    setupItemAnnotations(grp, {
                        currentDimensionX, currentDimensionY,
                        colorScale: currentState.colorScale,
                        language: currentState.language
                    });
                    grp.each(function () { this._layoutVersion = currentState.layoutVersion; });

                    grp.on("click", (event, d) => {
                        const now = new Date().getTime();
                        const isDoubleClick = (d.id === currentState.lastClickId) && ((now - currentState.lastClickTime) < DOUBLE_CLICK_THRESHOLD);

                        currentState.lastClickId = d.id;
                        currentState.lastClickTime = now;

                        ruler.update({
                            width, height, currentDimensionX, currentDimensionY,
                            xScale: d3.zoomTransform(svg.node()).rescaleX(xScale),
                            yScale: d3.zoomTransform(svg.node()).rescaleY(yScale)
                        });

                        if (callbacks.onClick) callbacks.onClick(event, d);

                        if (isDoubleClick) {
                            if (callbacks.onDblClick) callbacks.onDblClick(event, d);
                            currentState.lastClickId = null;
                            currentState.lastClickTime = 0;
                        }
                        event.stopPropagation();
                    });

                    return grp;
                },
                update => update,
                exit => exit.remove()
            )
            .attr('transform', d => {
                // Clusters are re-generated on dimension change, so IDs change.
                // It is hard to animate clusters smoothly between dimensions because they regroup.
                // For now, let's just snap clusters.
                return `translate(${newXScale(d._cachedX)}, ${newYScale(d._cachedY)})`;
            })
            .style('opacity', d => {
                if (currentState.hiddenIds.has(d.id)) return 0;
                // Fade in clusters during transition
                if (isTransitioning) return p;
                return null;
            })
            .style('pointer-events', d => currentState.hiddenIds.has(d.id) ? 'none' : null);

        // Update content of groups... 
        const clusterSelection = gCombined.selectAll('.item-group.combined');

        clusterSelection.each(function (d) {
            if (this._layoutVersion !== currentState.layoutVersion) {
                setupItemAnnotations(d3.select(this), {
                    currentDimensionX, currentDimensionY,
                    colorScale: currentState.colorScale,
                    language: currentState.language
                });
                this._layoutVersion = currentState.layoutVersion;
            }
        });

        // Optimization: Only update dynamic attributes (radius, hit area size driven by font size)
        clusterSelection.select('circle')
            .attr('r', currentRadius);

        // Update hit area dimensions (Extreme: No getBBox)
        clusterSelection.each(function (d) {
            const sel = d3.select(this);
            const estWidth = (d._estTextWidth || 0) * currentFS;

            sel.select('.hit-area')
                .attr('x', -currentRadius - 5).attr('y', -currentFS)
                .attr('height', currentFS * 2)
                .attr('width', estWidth + currentRadius + 20);

            sel.select('.label-bg')
                .attr('x', 8).attr('y', -currentFS * 0.7).attr('height', currentFS * 1.5)
                .attr('width', estWidth + 6);

            sel.select('text.label').style('font-size', `${currentFS}px`);
        });

        // 8. Annotations (Inequalities/Bars)
        // Now handled by updateAnnotationLayout logic calling.
        // We already called it for itemSelection.
        // For clusters, we usually don't have ranges/inequalities if they were grouped.
        // But if we did, we might want to call updateAnnotationLayout(clusterSelection...) too.
        // The setupItemAnnotations WAS called for them.
        // Let's call it to ensure fonts/colors update if needed, though we just manually sized bg/hit above.
        // updateAnnotationLayout also sizes bg/hit for single items.
        // To avoid conflict, we should probably NOT call updateAnnotationLayout for clusters if we do manual sizing above.
        // OR we move manual sizing into updateAnnotationLayout specialized for clusters?
        // Let's leave clusters as-is with manual sizing above (it works), and NOT call updateAnnotationLayout for them 
        // unless we want to support range lines on clusters (unlikely).
        // Actually, circle fill update happens in updateAnnotationLayout logic for single items.
        // For clusters, we might need it if highlight changes?
        // Clusters check 'highlighted' class?
        // Let's manually handle cluster circle fill here to match single item logic if needed, 
        // but setupItemAnnotations sets initial fill.
        // If we highlight a cluster, we want it white.
        clusterSelection.each(function (d) {
            const isHighlighted = d3.select(this).classed('highlighted');
            const cat = getLocalized(d._members[0].category, currentState.language);
            d3.select(this).select('circle').attr('fill', isHighlighted ? 'white' : currentState.colorScale(cat));
        });

        // Debug Box Update
        const debugBounds = getDynamicBounds(t.k);
        if (DEBUG_SHOW_BOUNDS && debugBounds) {
            const { minX, maxX, minY, maxY } = debugBounds;
            g.selectAll('.debug-box').data([debugBounds])
                .join('rect')
                .attr('class', 'debug-box')
                .attr('x', minX * t.k + t.x)
                .attr('y', minY * t.k + t.y)
                .attr('width', (maxX - minX) * t.k)
                .attr('height', (maxY - minY) * t.k)
                .attr('fill', 'none')
                .attr('stroke', 'red')
                .attr('stroke-width', 2);
        } else {
            g.selectAll('.debug-box').remove();
        }

        // 9. Ruler Update
        ruler.update({
            width, height, currentDimensionX, currentDimensionY,
            xScale: newXScale, yScale: newYScale,
            event: (checkTouch() && event && event.pointerType !== 'mouse') ? undefined : event
        });

        if (isTransitioning) {
            requestAnimationFrame(() => {
                const currentT = d3.zoomTransform(svg.node());
                render(currentT, event);
            });
        }
    }

    function handleZoom(event) {
        let t = event.transform;

        // Manual Pan Clamping
        // Manual Pan Clamping
        const bounds = getDynamicBounds(t.k);
        if (bounds) {
            const { minX, maxX, minY, maxY } = bounds;
            const margin = 50; // Allow panning 50px past data edge

            // Calculate Clamping Limits
            const minTx = -maxX * t.k - margin;
            const maxTx = width - minX * t.k + margin;
            const minTy = -maxY * t.k - margin;
            const maxTy = height - minY * t.k + margin;

            // Apply Clamp
            const tx = Math.min(Math.max(t.x, minTx), maxTx);
            const ty = Math.min(Math.max(t.y, minTy), maxTy);

            if (tx !== t.x || ty !== t.y) {
                t = new d3.ZoomTransform(t.k, tx, ty);
                // Update D3 internal state to prevent jumping on next gesture
                svg.node().__zoom = t;
            }
        }

        render(t, event.sourceEvent);
    }

    svg.call(zoom)
        .on("dblclick.zoom", null); // Disable double-click to zoom


    // Recenter Wheel Logic (Desktop Only)
    let lastRecenterTime = 0;
    svg.node().addEventListener('wheel', (event) => {
        if (checkTouch()) return;

        const t = d3.zoomTransform(svg.node());
        if (t.k <= minZoom * 1.05 && event.deltaY > 0) {
            const now = Date.now();
            if (now - lastRecenterTime > 1500) {
                lastRecenterTime = now;
                resetZoom(750);
            }
        }
    }, { capture: true, passive: true });


    // Helper: Highlight
    // Needs to work even if item is not currently rendered (if possible)? 
    // Actually, if we search for something and zoom to it, we render it.
    // If we highlight something off screen, it won't exist.
    // But typically we zoom to it first.
    function highlightItem(d) {
        // 1. First render to apply classes/colors
        render(d3.zoomTransform(svg.node()));

        // 2. Then raise to ensure it is on top of what was just rendered
        g.selectAll('.item-group').classed("highlighted", false);
        gCombined.selectAll('.item-group').classed("highlighted", false);

        // If it's a combined item (from search result or internal logic)
        if (d._isCombined) {
            gCombined.raise();
            gCombined.selectAll('.item-group.combined').filter(cd => cd.id === d.id).classed("highlighted", true).raise();
            return;
        }

        // Check if item is inside a cluster
        let parentClusterId = null;
        const clusters = currentState.clusters;
        const parent = clusters.find(c => c._members.some(m => m.id === d.id));
        if (parent) parentClusterId = parent.id;

        if (parentClusterId) {
            gCombined.raise();
            gCombined.selectAll('.item-group.combined').filter(cd => cd.id === parentClusterId).classed("highlighted", true).raise();
        } else {
            g.raise();
            g.selectAll('.item-group').filter(item => item.id === d.id).classed("highlighted", true).raise();
        }
    }

    function unhighlightItems() {
        g.selectAll('.item-group').classed("highlighted", false);
        gCombined.selectAll('.item-group').classed("highlighted", false);
        render(d3.zoomTransform(svg.node()));
    }

    function zoomToCategory(cat) {
        // Clear ruler mark on desktop when focusing on a category
        if (!checkTouch() && ruler) {
            ruler.clearMark();
        }

        // Use pre-filtered data (guarantees valid coordinates and visibility logic consistency)
        const data = currentState.filteredData || [];
        const language = currentState.language;

        const categoryData = data.filter(item => getLocalized(item.category, language) === cat);

        if (categoryData.length === 0) return;

        if (categoryData.length === 1) {
            zoomToItem(categoryData[0], false);
            if (callbacks.onCategoryClick) callbacks.onCategoryClick(cat);
            return;
        }

        if (callbacks.onCategoryClick) callbacks.onCategoryClick(cat);

        // Calculate "Base" extents (at Zoom=1 equivalent, used for inputs)
        const candidates = categoryData.map(d => computePointVisuals(d, xScale, yScale, currentDimensionX, currentDimensionY, 12));

        // Iterative solving for K
        // We want to fit [minX_scr, maxX_scr] into Width and [minY_scr, maxY_scr] into Height.
        // ScreenPos = WorldPos * k + trans.
        // WorldPos is what we have in `candidates` (x, y) assuming x/yScale are base scales.
        // ScreenExt = extC + extS * (visualFS / 12).
        // visualFS = max(4, min(12, baseDecadeHeight * k)).

        const baseDecadeHeight = Math.abs(yScale(10) - yScale(1));
        const padLeft = Math.min(180, width * 0.1);
        const padRight = Math.min(460, width * 0.1);
        const padTop = Math.min(60, height * 0.05);
        const padBottom = Math.min(120, height * 0.1);
        const availWidth = width - padLeft - padRight;
        const availHeight = height - padTop - padBottom;

        // Initial guess (ignoring extents)
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        candidates.forEach(c => {
            minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
            minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
        });

        let targetK = 1;
        if (minX !== Infinity) {
            const dw = maxX - minX || 1;
            const dh = maxY - minY || 1;
            targetK = Math.min(availWidth / dw, availHeight / dh);
        }
        targetK = Math.min(Math.max(targetK, 0.001), 100000);

        // Iterative refinement (3 passes usually enough)
        for (let pass = 0; pass < 3; pass++) {
            const visualFS = Math.max(4, Math.min(12, baseDecadeHeight * targetK));
            const scalingFactorS = visualFS / 12;
            // Screen extent = extC + extS * scalingFactorS.
            // Note: This is pure screen pixels *around the point center*.
            // Screen_Left = (x * k) - (lc + ls * scalingFactorS)

            let sMinX = Infinity, sMaxX = -Infinity, sMinY = Infinity, sMaxY = -Infinity;

            candidates.forEach(c => {
                const l = c.lc + c.ls * scalingFactorS;
                const r = c.rc + c.rs * scalingFactorS;
                const u = c.uc + c.us * scalingFactorS;
                const d = c.dc + c.ds * scalingFactorS;

                // We calculate bounds in "Scaled World Space" relative to arbitrary origin
                // x_scr = x * k. 
                const sx = c.x * targetK;
                const sy = c.y * targetK;

                sMinX = Math.min(sMinX, sx - l);
                sMaxX = Math.max(sMaxX, sx + r);
                sMinY = Math.min(sMinY, sy - u);
                sMaxY = Math.max(sMaxY, sy + d);
            });

            const reqW = sMaxX - sMinX;
            const reqH = sMaxY - sMinY;

            // reqW should fit in availWidth.
            // current w = reqW. desired = availWidth.
            // factor = availWidth / reqW.
            // But reqW has non-linear usage of K (in l/r).
            // Approximate update.
            const factorX = availWidth / reqW;
            const factorY = availHeight / reqH;
            const factor = Math.min(factorX, factorY);

            targetK = targetK * factor;
            targetK = Math.min(Math.max(targetK, 0.0001), 100000);
        }

        // Final calculation for Center
        const visualFS = Math.max(4, Math.min(12, baseDecadeHeight * targetK));
        const scalingFactorS = visualFS / 12;

        let sMinX = Infinity, sMaxX = -Infinity, sMinY = Infinity, sMaxY = -Infinity;
        candidates.forEach(c => {
            const l = c.lc + c.ls * scalingFactorS;
            const r = c.rc + c.rs * scalingFactorS;
            const u = c.uc + c.us * scalingFactorS;
            const d = c.dc + c.ds * scalingFactorS;
            const sx = c.x * targetK;
            const sy = c.y * targetK;
            sMinX = Math.min(sMinX, sx - l);
            sMaxX = Math.max(sMaxX, sx + r);
            sMinY = Math.min(sMinY, sy - u);
            sMaxY = Math.max(sMaxY, sy + d);
        });

        const screenCX = padLeft + availWidth / 2;
        const screenCY = padTop + availHeight / 2;

        const contentCX = (sMinX + sMaxX) / 2; // In scaled space
        const contentCY = (sMinY + sMaxY) / 2;

        // translate = screenCenter - contentCenter
        // contentCenter = worldCenter * k + trans? No.
        // We want: world * k + trans = screen.
        // scale(k).translate(tx, ty)? No. d3 Identity.translate(tx, ty).scale(k).
        // x_final = (x_world * k) + tx.
        // We want centre of bounding box to be at screenCX.
        // contentCX is center of (x_world * k).
        // So contentCX + tx = screenCX.
        // tx = screenCX - contentCX.

        const tx = screenCX - contentCX;
        const ty = screenCY - contentCY;

        svg.transition().duration(750)
            .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(targetK));
    }

    function update(data, state) {
        if (width === 0 || height === 0 || isInitialLoad) {
            width = container.clientWidth;
            height = container.clientHeight;
            if (width > 0 && height > 0) {
                svg.attr('viewBox', [0, 0, width, height]);
                yScale.range([height - 50, 50]);
            }
        }

        currentState = { ...currentState, ...state, data };
        if (state.currentDimensionX) currentDimensionX = state.currentDimensionX;
        if (state.currentDimensionY) currentDimensionY = state.currentDimensionY;

        const dimChanged = (currentDimensionX !== prevDimensionX) || (currentDimensionY !== prevDimensionY);

        if (dimChanged && !isInitialLoad) {
            // Capture State for Transition
            prevTransform = d3.zoomTransform(svg.node());
            transitionPrevDimX = prevDimensionX;
            transitionPrevDimY = prevDimensionY;

            prevXScale = xScale.copy();
            prevYScale = yScale.copy();

            // Cache previous coordinates on data objects
            currentState.data.forEach(d => {
                d._prevX = getDimensionValueX(d, prevDimensionX, prevDimensionY);
                d._prevY = getDimensionValueY(d, prevDimensionY);

                // Also capture range endpoints in OLD world space
                const oldValY = parseValue(d.dimensions[prevDimensionY]);
                if (oldValY.type === "range") {
                    d._prevRangeV1 = oldValY.value;
                    d._prevRangeV2 = oldValY.value2;
                } else {
                    d._prevRangeV1 = d._prevRangeV2 = undefined;
                }
            });


            transitionStartTime = Date.now();
            isTransitioning = true;
        }

        // Optimization: Calculate filteredData, increment version, and CACHE VALUES

        const filteredData = getFilteredData(data, currentDimensionX, currentDimensionY);

        if (dimChanged) {
            // Identify Exiting Items (Was Visible -> No longer Visible)
            // Optimization: Only animate items that were actually rendered
            // properties `d` are the objects.
            const previouslyRendered = g.selectAll('.item-group').data();
            const newIds = new Set(filteredData.map(d => d.id));

            transitionExitingItems = previouslyRendered.filter(d => !newIds.has(d.id));

            // Mark them as exiting for render loop
            transitionExitingItems.forEach(d => d._isExiting = true);

            // Clean flags on new items
            filteredData.forEach(d => d._isExiting = false);
        } else if (!isTransitioning) {
            transitionExitingItems = [];
        }
        const clusters = getClusters(currentState.data, currentDimensionX, currentDimensionY, currentState.language);

        currentState.layoutVersion = (currentState.layoutVersion || 0) + 1;

        // Cache coordinates and estimated text width
        const charRatio = 0.6;
        filteredData.forEach(d => {
            d._cachedX = getDimensionValueX(d, currentDimensionX, currentDimensionY);
            d._cachedY = getDimensionValueY(d, currentDimensionY);
            const text = getLocalized(d.displayName, currentState.language) || "";
            d._estTextWidth = text.length * charRatio;
        });

        clusters.forEach(c => {
            const first = c._members[0];
            c._cachedX = getDimensionValueX(first, currentDimensionX, currentDimensionY);
            c._cachedY = getDimensionValueY(first, currentDimensionY);
            const combinedName = getLocalized(c.displayName, currentState.language) || "";
            c._estTextWidth = combinedName.length * charRatio;
        });

        // Binary search requires sorting by the cached Y coordinate
        filteredData.sort((a, b) => a._cachedY - b._cachedY);
        clusters.sort((a, b) => a._cachedY - b._cachedY);

        // Initialize stable sort index for consistent culling
        filteredData.forEach((d, i) => d._priorityIndex = i);
        clusters.forEach((d, i) => d._priorityIndex = i);

        prevDimensionX = currentDimensionX;
        prevDimensionY = currentDimensionY;
        // Pre-calculation removed: Proximity culling now happens in render() on visible subset


        currentState.filteredData = filteredData;
        currentState.clusters = clusters;

        if (filteredData.length === 0) {
            g.selectAll('.item-group').remove();
            gCombined.selectAll('.item-group').remove();
            legend.updateLegend([], { ...currentState, width, height, onCategoryClick: zoomToCategory });
            return;
        }

        // Y Scale Domain calculation
        let minDimY = filteredData[0]._cachedY;
        let maxDimY = filteredData[filteredData.length - 1]._cachedY;

        if (minDimY === maxDimY) {
            if (minDimY <= 0) { minDimY = 0.1; maxDimY = 10; }
            else { minDimY = minDimY / 10; maxDimY = maxDimY * 10; }
        }
        yScale.domain([minDimY, maxDimY]);
        if (currentDimensionX !== "none") yScale.range([height - fadeBottomHeight, 50]);
        else yScale.range([height - 50, 50]);

        // X Scale
        if (currentDimensionX === "none") {
            xScale = d3.scaleLinear();
            const minX = d3.min(filteredData, d => d._cachedX);
            const maxX = d3.max(filteredData, d => d._cachedX);

            const initialDecadeHeight = Math.abs(yScale(10) - yScale(1));
            const screenCenter = width / 2;

            if (minX === maxX) {
                xScale.domain([minX, minX + 1]).range([screenCenter, screenCenter + initialDecadeHeight]);
            } else {
                const xCenter = (minX + maxX) / 2;
                const pixelMin = screenCenter + (minX - xCenter) * initialDecadeHeight;
                const pixelMax = screenCenter + (maxX - xCenter) * initialDecadeHeight;
                xScale.domain([minX, maxX]).range([pixelMin, pixelMax]);
            }
        } else {
            xScale = d3.scaleLog();
            const minDimX = d3.min(filteredData, d => d._cachedX);
            const maxDimX = d3.max(filteredData, d => d._cachedX);
            xScale.domain([minDimX, maxDimX]);

            const maxCharCount = d3.max(filteredData, d => getLocalized(d.displayName, currentState.language).length) || 10;
            paddingRight = Math.max(100, maxCharCount * 12 * 0.6 + 40);

            // Clamp padding
            const effectiveFadeEnd = Math.min(fadeEnd, width * 0.15);
            const effectivePadRight = Math.min(paddingRight, width * 0.15);
            const effectiveFadeBotH = Math.min(fadeBottomHeight, height * 0.15);

            const xDecades = Math.log10(maxDimX) - Math.log10(minDimX) || 1;
            const yDecades = Math.log10(maxDimY) - Math.log10(minDimY) || 1;
            const availW = Math.max(1, width - effectivePadRight - effectiveFadeEnd);
            const availH = Math.max(1, (height - effectiveFadeBotH) - 50);
            const ppdX = availW / xDecades;
            const ppdY = availH / yDecades;
            const ppd = Math.min(ppdX, ppdY);
            const newWidth = xDecades * ppd;
            const newHeight = yDecades * ppd;
            const xOffset = (availW - newWidth) / 2;
            const yOffset = (availH - newHeight) / 2;

            xScale.range([effectiveFadeEnd + xOffset, effectiveFadeEnd + xOffset + newWidth]);
            const topPixel = 50 + yOffset;
            const bottomPixel = topPixel + newHeight;
            yScale.range([bottomPixel, topPixel]);
        }

        // Calculate dynamic zoom-out limit (including label widths)
        const allPoints = filteredData.concat(clusters);
        if (allPoints.length > 0) {
            // Font size at zoom=1 reference
            const baseDecadeHeight = Math.abs(yScale(10) - yScale(1));

            // Pre-calculate Convex Hulls for Dynamic Bounds
            const boundsCandidates = []; // {x, y, l, r, u, d}
            const precisionFS = 12; // Max font size (capped at 12)

            allPoints.forEach(d => {
                const visuals = computePointVisuals(d, xScale, yScale, currentDimensionX, currentDimensionY, precisionFS);
                if (visuals) {
                    boundsCandidates.push(visuals);
                }
            });

            // Build Hulls
            const filterHull = (list, keyPos, keyExt, isMin) => {
                list.sort((a, b) => isMin ? a[keyPos] - b[keyPos] : b[keyPos] - a[keyPos]);
                const hull = [];
                let maxExt = -Infinity;
                for (const p of list) {
                    if (p[keyExt] > maxExt) {
                        hull.push(p);
                        maxExt = p[keyExt];
                    }
                }
                return hull;
            };

            const hulls = {
                minX: filterHull([...boundsCandidates], 'x', 'l', true),
                maxX: filterHull([...boundsCandidates], 'x', 'r', false),
                minY: filterHull([...boundsCandidates], 'y', 'u', true),
                maxY: filterHull([...boundsCandidates], 'y', 'd', false),
                baseDecadeHeight: baseDecadeHeight
            };
            currentState.boundsHulls = hulls;




            // Calculate Initial Bounds (Low Zoom assumption)
            // Use k=0.1 equiv
            let dataMinX = Infinity, dataMaxX = -Infinity, dataMinY = Infinity, dataMaxY = -Infinity;
            // worldExt = (p.ext / 12) * baseDecadeHeight (since k is low, fs scales with k, ext/k constant)
            // Wait. fs = baseDH * k. ext = ext12 * (fs/12). 
            // worldExt = ext/k = ext12 * (baseDH*k/12) / k = ext12 * baseDH / 12.
            // This constant worldExt applies when `baseDH * k < 12`.

            const getLowZoomBound = (list, sign, keyPos, keyExt) => {
                let best = (sign < 0) ? Infinity : -Infinity;
                for (const p of list) {
                    const worldExt = (p[keyExt] / 12) * baseDecadeHeight;
                    const val = p[keyPos] + (sign * worldExt); // min: x - ext. max: x + ext.
                    if (sign < 0) best = Math.min(best, val);
                    else best = Math.max(best, val);
                }
                return best;
            };

            if (boundsCandidates.length > 0) {
                dataMinX = getLowZoomBound(hulls.minX, -1, 'x', 'l');
                dataMaxX = getLowZoomBound(hulls.maxX, 1, 'x', 'r');
                dataMinY = getLowZoomBound(hulls.minY, -1, 'y', 'u');
                dataMaxY = getLowZoomBound(hulls.maxY, 1, 'y', 'd');
            } else {
                dataMinX = 0; dataMaxX = 1; dataMinY = 0; dataMaxY = 1;
            }

            // Perform 'Reset Zoom' equivalent calculation using minZoom

            // Align with axis layout logic (lines 856+)
            const isMobile = checkMobile();
            // On mobile, safe area excludes the tick labels. 
            // 80px (paddingLeft) matches the axis layout padding.
            const leftMargin = isMobile ? paddingLeft : fadeEnd;
            // Mobile needs standard bottom padding
            const bottomMargin = isMobile ? paddingBottom : fadeBottomHeight;

            // Always apply left margin to avoid Y-axis labels (present in both 1D and 2D)
            const safeLeft = leftMargin;
            const safeRight = width;
            const safeTop = 0;
            const safeBottom = (currentDimensionX !== "none") ? height - bottomMargin : height;

            const availWidth = Math.max(1, safeRight - safeLeft);
            const availHeight = Math.max(1, safeBottom - safeTop);

            // Start with a reasonable guess
            let bestK = 0.001;

            // Previous heuristic was:
            const dataW = (dataMaxX - dataMinX) || 1;
            const dataH = (dataMaxY - dataMinY) || 1;
            // fitScale is approximate because it ignores label widths scaling non-linearly
            let approxK = Math.min(availWidth / dataW, availHeight / dataH);
            approxK = Math.min(Math.max(approxK, 0.00001), 100000);

            // Refine K using iterative solver to ensure labels fit logic
            bestK = approxK;
            for (let i = 0; i < 5; i++) {
                const b = getDynamicBounds(bestK);
                if (!b) break; // Should not happen given we have hulls
                const w = (b.maxX - b.minX) * bestK;
                const h = (b.maxY - b.minY) * bestK;
                if (w <= 0 || h <= 0) break;

                const fX = availWidth / w;
                const fY = availHeight / h;
                const factor = Math.min(fX, fY);

                if (Math.abs(factor - 1) < 0.01) break;

                bestK = bestK * factor;
            }

            const extraPadding = 0.95;
            bestK = bestK * extraPadding;

            minZoom = Math.max(0.000001, Math.min(bestK, 1)); // Cap at 1 to avoid zooming IN to single points too much

            zoom.scaleExtent([minZoom, 1000000]);

            currentState.dataBounds = { minX: dataMinX, maxX: dataMaxX, minY: dataMinY, maxY: dataMaxY };
            zoom.translateExtent([[-Infinity, -Infinity], [Infinity, Infinity]]);
        } else {
            minZoom = 1;
            zoom.scaleExtent([1, 1000000]);
            currentState.dataBounds = null;
            zoom.translateExtent([[-Infinity, -Infinity], [Infinity, Infinity]]);
        }

        // Calculate Hidden IDs
        const hiddenIds = new Set();
        clusters.forEach(c => {
            c._members.forEach(m => hiddenIds.add(m.id));
        });
        currentState.hiddenIds = hiddenIds;

        legend.updateLegend(filteredData, { ...currentState, width, height, onCategoryClick: zoomToCategory });
        updateMask(width, height, currentDimensionX, checkMobile());


        prevDimensionX = currentDimensionX;

        prevDimensionY = currentDimensionY;

        // Calculate initial transform considering mobile safe area for x-dimension
        const isMobile = checkMobile();
        const leftMargin = isMobile ? paddingLeft : fadeEnd;
        // Mobile needs more bottom padding for X-axis labels
        const bottomMargin = isMobile ? paddingBottom : fadeBottomHeight;

        let initialTransform;
        if (currentDimensionX === "none") {
            initialTransform = d3.zoomIdentity.translate(-width * 0.05, 0);
        } else {
            // When x-dimension is active, we want to align the left edge with the leftMargin
            // The default d3.zoomIdentity has tx=0. We need to shift it by leftMargin.
            initialTransform = d3.zoomIdentity.translate(leftMargin, 0);
        }

        if (isInitialLoad) {
            // Initial Load: Set view to 10x REALTIVE zoom immediately
            // startK is 10x the final "fit to screen" zoom (minZoom)
            const startK = minZoom * 10;

            const bounds = getDynamicBounds(startK);
            if (bounds) {
                const cX = (bounds.minX + bounds.maxX) / 2;
                const cY = (bounds.minY + bounds.maxY) / 2;
                const tx = (width / 2) - (cX * startK);
                const ty = (height / 2) - (cY * startK);
                svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(startK));
            } else {
                svg.call(zoom.transform, d3.zoomIdentity.scale(startK));
            }
            isInitialLoad = false;
        }

        else if (dimChanged) {
            // Dimension change (not initial): Animate to fit all data
            const bounds = getDynamicBounds(minZoom);
            if (bounds) {
                const bottomMargin = fadeBottomHeight;
                const safeLeft = (currentDimensionX !== "none") ? leftMargin : 0;
                const safeRight = width;
                const safeTop = 0;
                const safeBottom = (currentDimensionX !== "none") ? height - bottomMargin : height;

                const safeCenterX = (safeLeft + safeRight) / 2;
                const safeCenterY = (safeTop + safeBottom) / 2;
                const cX = (bounds.minX + bounds.maxX) / 2;
                const cY = (bounds.minY + bounds.maxY) / 2;
                const tx = safeCenterX - (cX * minZoom);
                const ty = safeCenterY - (cY * minZoom);

                svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(minZoom));
            } else {
                svg.call(zoom.transform, initialTransform);
            }
        } else {
            render(d3.zoomTransform(svg.node()));
        }

    }

    // ... (rest of function remains same structure, just updated content above covers it) ...
    // Note: The previous logic for resize/setCallbacks/listeners was included in the replacement content block above.

    function setCallbacks(newCallbacks) { callbacks = { ...callbacks, ...newCallbacks }; }
    function resize() {
        const t = d3.zoomTransform(svg.node());
        const rescaledX = t.rescaleX(xScale);
        const rescaledY = t.rescaleY(yScale);
        const dataX = rescaledX.invert(width / 2);
        const dataY = rescaledY.invert(height / 2);

        width = container.clientWidth;
        height = container.clientHeight;
        svg.attr('viewBox', [0, 0, width, height]);

        // Re-calculate ranges based on aspect ratio logic (Sync with update())
        if (currentDimensionX !== "none") {
            const domainX = xScale.domain();
            const domainY = yScale.domain();
            const xDecades = Math.log10(domainX[1]) - Math.log10(domainX[0]) || 1;
            const yDecades = Math.log10(domainY[1]) - Math.log10(domainY[0]) || 1;

            const effectiveFadeEnd = Math.min(fadeEnd, width * 0.15);
            const effectivePadRight = Math.min(paddingRight, width * 0.15);
            const effectiveFadeBotH = Math.min(checkMobile() ? paddingBottom : fadeBottomHeight, height * 0.15);

            const availW = Math.max(1, width - effectivePadRight - effectiveFadeEnd);
            const availH = Math.max(1, (height - effectiveFadeBotH) - 50);

            // Preserve current scale (PPD) instead of fitting to screen
            const currentRangeX = xScale.range();
            const newW = currentRangeX[1] - currentRangeX[0];
            const currentRangeY = yScale.range();
            // Y range is inverted [bottom, top]
            const newH = Math.abs(currentRangeY[0] - currentRangeY[1]);

            const xOff = (availW - newW) / 2;
            const yOff = (availH - newH) / 2;

            xScale.range([effectiveFadeEnd + xOff, effectiveFadeEnd + xOff + newW]);
            yScale.range([50 + yOff + newH, 50 + yOff]);
        } else {
            // Preserve current scale (PPD) vertically too
            const currentRangeY = yScale.range();
            // Y range is inverted [bottom, top]
            const currentHeight = Math.abs(currentRangeY[0] - currentRangeY[1]);
            const yOff = (height - currentHeight) / 2;

            // Center vertically within new height
            // Assume 50 padding was original context, but now we center arbitrarily
            // Actually, we want center to align.
            // If scale was [bottom, top], center is (bottom+top)/2.
            // New Bottom = yOff + currentHeight. New Top = yOff.
            // Wait, D3 uses [max, min] for Y usually.
            // So range should be [height - yOff, yOff].
            yScale.range([height - yOff, yOff]);

            // Fix: Update 1D xScale to match new Y-axis density (maintain aspect ratio)
            const domain = xScale.domain();
            const minX = domain[0];
            const maxX = domain[1];

            // Calculate new decade height based on updated yScale
            const initialDecadeHeight = Math.abs(yScale(10) - yScale(1));
            const screenCenter = width / 2;

            if (minX === maxX) {
                xScale.range([screenCenter, screenCenter + initialDecadeHeight]);
            } else {
                const xCenter = (minX + maxX) / 2;
                const pixelMin = screenCenter + (minX - xCenter) * initialDecadeHeight;
                const pixelMax = screenCenter + (maxX - xCenter) * initialDecadeHeight;
                xScale.range([pixelMin, pixelMax]);
            }
        }

        updateMask(width, height, currentDimensionX, checkMobile());
        legend.reposition(width, height);

        // Rebuild boundsHulls and recalculate minZoom for the new viewport/scales
        const allPoints = (currentState.filteredData || []).concat(currentState.clusters || []);
        if (allPoints.length > 0) {
            const baseDecadeHeight = Math.abs(yScale(10) - yScale(1));
            const precisionFS = 12;
            const boundsCandidates = [];

            allPoints.forEach(d => {
                const visuals = computePointVisuals(d, xScale, yScale, currentDimensionX, currentDimensionY, precisionFS);
                if (visuals) boundsCandidates.push(visuals);
            });

            const filterHull = (list, keyPos, keyExt, isMin) => {
                list.sort((a, b) => isMin ? a[keyPos] - b[keyPos] : b[keyPos] - a[keyPos]);
                const hull = [];
                let maxExt = -Infinity;
                for (const p of list) {
                    if (p[keyExt] > maxExt) {
                        hull.push(p);
                        maxExt = p[keyExt];
                    }
                }
                return hull;
            };

            const hulls = {
                minX: filterHull([...boundsCandidates], 'x', 'l', true),
                maxX: filterHull([...boundsCandidates], 'x', 'r', false),
                minY: filterHull([...boundsCandidates], 'y', 'u', true),
                maxY: filterHull([...boundsCandidates], 'y', 'd', false),
                baseDecadeHeight
            };
            currentState.boundsHulls = hulls;

            // Recalculate dataBounds
            const getLowZoomBound = (list, sign, keyPos, keyExt) => {
                let best = (sign < 0) ? Infinity : -Infinity;
                for (const p of list) {
                    const worldExt = (p[keyExt] / 12) * baseDecadeHeight;
                    const val = p[keyPos] + (sign * worldExt);
                    if (sign < 0) best = Math.min(best, val);
                    else best = Math.max(best, val);
                }
                return best;
            };

            if (boundsCandidates.length > 0) {
                const dataMinX = getLowZoomBound(hulls.minX, -1, 'x', 'l');
                const dataMaxX = getLowZoomBound(hulls.maxX, 1, 'x', 'r');
                const dataMinY = getLowZoomBound(hulls.minY, -1, 'y', 'u');
                const dataMaxY = getLowZoomBound(hulls.maxY, 1, 'y', 'd');
                currentState.dataBounds = { minX: dataMinX, maxX: dataMaxX, minY: dataMinY, maxY: dataMaxY };
            }

            // Recalculate minZoom
            const isMobile = checkMobile();
            const leftMargin = isMobile ? paddingLeft : fadeEnd;
            const bottomMargin = isMobile ? paddingBottom : fadeBottomHeight;

            const safeLeft = leftMargin;
            const safeRight = width;
            const safeTop = 0;
            const safeBottom = (currentDimensionX !== "none") ? height - bottomMargin : height;

            const availWidth = Math.max(1, safeRight - safeLeft);
            const availHeight = Math.max(1, safeBottom - safeTop);

            const db = currentState.dataBounds;
            if (db) {
                const dataW = (db.maxX - db.minX) || 1;
                const dataH = (db.maxY - db.minY) || 1;
                let bestK = Math.min(availWidth / dataW, availHeight / dataH);
                bestK = Math.min(Math.max(bestK, 0.00001), 100000);

                for (let i = 0; i < 5; i++) {
                    const b = getDynamicBounds(bestK);
                    if (!b) break;
                    const w = (b.maxX - b.minX) * bestK;
                    const h = (b.maxY - b.minY) * bestK;
                    if (w <= 0 || h <= 0) break;

                    const fX = availWidth / w;
                    const fY = availHeight / h;
                    const factor = Math.min(fX, fY);

                    if (Math.abs(factor - 1) < 0.01) break;
                    bestK = bestK * factor;
                }

                bestK = bestK * 0.95;
                minZoom = Math.max(0.000001, Math.min(bestK, 1));
                zoom.scaleExtent([minZoom, 1000000]);
            }
        }

        // Update transform to preserve center
        const newT = d3.zoomIdentity
            .translate(width / 2, height / 2)
            .scale(Math.max(t.k, minZoom))
            .translate(-xScale(dataX), -yScale(dataY));

        svg.call(zoom.transform, newT);

        // Explicitly update ruler position after resize
        const finalT = d3.zoomTransform(svg.node());
        ruler.update({
            width, height, currentDimensionX, currentDimensionY,
            xScale: finalT.rescaleX(xScale), yScale: finalT.rescaleY(yScale)
        });
    }

    svg.on("pointermove", (event) => {
        const isTouch = checkTouch();
        if (isTouch && event.pointerType !== 'mouse') return;
        const t = d3.zoomTransform(svg.node());
        ruler.update({
            width, height, currentDimensionX, currentDimensionY,
            xScale: t.rescaleX(xScale), yScale: t.rescaleY(yScale), event
        });
    });

    svg.on("pointerleave", (event) => {
        const isTouch = checkTouch();
        if (!isTouch || event.pointerType === 'mouse') ruler.hide();
    });

    svg.on("click", (e) => {
        const isTouch = checkTouch();
        if (isTouch) {
            ruler.hide();
            ruler.clearMark();
        }
    }); // Hide ruler and mark on background click/tap (mobile only)

    svg.on("contextmenu", (event) => {
        event.preventDefault();
        const t = d3.zoomTransform(svg.node());
        const [mouseX, mouseY] = d3.pointer(event, svg.node());
        const newYScale = t.rescaleY(yScale);
        const markedY = newYScale.invert(mouseY);
        let markedX = null;
        if (currentDimensionX !== "none") {
            const newXScale = t.rescaleX(xScale);
            markedX = newXScale.invert(mouseX);
        }
        ruler.setMark(markedX, markedY, currentDimensionX);
        ruler.update({
            width, height, currentDimensionX, currentDimensionY,
            xScale: t.rescaleX(xScale), yScale: newYScale, event
        });
    });

    let touchTimer = null;
    let touchStartX = 0, touchStartY = 0;
    let isRulerActiveForTouch = false;

    svg.node().addEventListener('touchstart', (e) => {
        // Prevent background logic if touching the ruler itself or the mark
        if (e.target.closest && (e.target.closest('.cursor-ruler') || e.target.closest('.mark-ruler'))) {
            return;
        }

        if (e.touches.length === 1) {
            const touch = e.touches[0];
            touchStartX = touch.clientX;
            touchStartY = touch.clientY;
            isRulerActiveForTouch = false;

            // Capture coordinates for the timer callback
            const cx = touch.clientX;
            const cy = touch.clientY;

            touchTimer = setTimeout(() => {
                isRulerActiveForTouch = true;
                const t = d3.zoomTransform(svg.node());

                // Construct mock event manually to avoid accessing revoked event or changed touches
                const mockEvent = {
                    type: 'touch',
                    sourceEvent: null, // Don't hold onto the original event
                    clientX: cx,
                    clientY: cy,
                    target: svg.node(),
                    view: window
                };

                ruler.update({
                    width, height, currentDimensionX, currentDimensionY,
                    xScale: t.rescaleX(xScale), yScale: t.rescaleY(yScale),
                    event: mockEvent
                });

                if (navigator.vibrate) navigator.vibrate(50);
            }, 400);
        }
    }, { passive: false, capture: true });

    svg.node().addEventListener('touchmove', (e) => {
        if (isRulerActiveForTouch) {
            e.preventDefault();
            e.stopPropagation();
            const t = d3.zoomTransform(svg.node());
            const touch = e.touches[0];
            const mockEvent = {
                type: 'touch',
                sourceEvent: null,
                clientX: touch.clientX,
                clientY: touch.clientY,
                target: svg.node(),
                view: window
            };
            ruler.update({
                width, height, currentDimensionX, currentDimensionY,
                xScale: t.rescaleX(xScale), yScale: t.rescaleY(yScale),
                event: mockEvent
            });
        } else {
            const dx = Math.abs(e.touches[0].clientX - touchStartX);
            const dy = Math.abs(e.touches[0].clientY - touchStartY);
            if (dx > 20 || dy > 20) {
                if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; }
            }
        }
    }, { passive: false, capture: true });

    const endTouch = (e) => {
        if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; }
        if (isRulerActiveForTouch) {
            if (e && e.cancelable) e.preventDefault();
            e.stopPropagation();
        }
        isRulerActiveForTouch = false;
    };

    svg.node().addEventListener('touchend', endTouch, { capture: true });
    svg.node().addEventListener('touchcancel', endTouch, { capture: true });
    function resetZoom(duration = 750) {
        if (!currentState.boundsHulls) {
            if (currentDimensionX === "none") {
                svg.transition().duration(duration).call(zoom.transform, d3.zoomIdentity.translate(-width * 0.05, 0));
            } else {
                svg.transition().duration(duration).call(zoom.transform, d3.zoomIdentity);
            }
            return;
        }

        const targetK = minZoom;
        const bounds = getDynamicBounds(targetK);

        if (!bounds) return;

        // Align with axis layout logic
        const isMobile = checkMobile();
        const leftMargin = isMobile ? paddingLeft : fadeEnd;
        const bottomMargin = isMobile ? paddingBottom : fadeBottomHeight;

        const safeLeft = leftMargin;
        const safeRight = width;
        const safeTop = 0;
        const safeBottom = (currentDimensionX !== "none") ? height - bottomMargin : height;

        // Center in safe area
        const safeCenterX = (safeLeft + safeRight) / 2;
        const safeCenterY = (safeTop + safeBottom) / 2;

        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;

        // Calculate translation to center the bounding box in the safe area
        const tx = safeCenterX - (centerX * targetK);
        const ty = safeCenterY - (centerY * targetK);

        const transform = d3.zoomIdentity.translate(tx, ty).scale(targetK);

        svg.transition().duration(duration).call(zoom.transform, transform);
    }

    function zoomToItem(item, highlight = true) {
        let matchItem = currentState.data.find(d => d.id === item.id);
        if (!matchItem && currentState.clusters) {
            matchItem = currentState.clusters.find(c => c.id === item.id);
        }
        if (!matchItem) return;


        const rawDimY = matchItem.dimensions[currentDimensionY];
        const valY = Array.isArray(rawDimY)
            ? Math.sqrt(Number(rawDimY[0]) * Number(rawDimY[1]))
            : getDimensionValueY(matchItem, currentDimensionY);

        const availableHeight = height - 100;
        const availableWidth = width - 100;
        let targetScale = 1;

        if (Array.isArray(rawDimY)) {
            // Range Item: Zoom to fit the range
            const y1_raw = yScale(Number(rawDimY[0]));
            const y2_raw = yScale(Number(rawDimY[1]));
            const deltaY = Math.abs(y1_raw - y2_raw);
            if (deltaY > 0) {
                // Fit range into 70% of available height
                // deltaY is in BASE pixels (zoom=1).
                // We want deltaY * targetScale = availableHeight * 0.7
                targetScale = (availableHeight * 0.7) / deltaY;
            } else {

                targetScale = 1000; // Fallback
            }
        }
        targetScale = Math.max(1, Math.min(targetScale, 1000)); // Lower cap for ranges

        let nearestItem = null;
        if (!Array.isArray(rawDimY)) {
            // Single Point: Zoom until nearest neighbor is ~30px away
            // NOTE: We must pass currentDimensionX/Y to filter correctly!
            const filteredData = getFilteredData(currentState.data || [], currentDimensionX, currentDimensionY);

            // Calculate distance in "decades" (log space) to find nearest neighbor
            const cx = (currentDimensionX === "none") ? matchItem._cachedX : Math.log10(matchItem._cachedX);
            const cy = Math.log10(matchItem._cachedY);

            let minDistSq = Infinity;
            let nearestItem = null;

            filteredData.forEach((d, i) => {
                if (d.id === matchItem.id) return;
                const dx = (currentDimensionX === "none") ? d._cachedX : Math.log10(d._cachedX);
                const dy = Math.log10(d._cachedY);
                const distSq = (dx - cx) ** 2 + (dy - cy) ** 2;

                // Ignore effectively coincident points (duplicates) to prevent infinite zoom
                if (distSq > 0.00000001 && distSq < minDistSq) {
                    minDistSq = distSq;
                    nearestItem = d;
                }
            });

            if (minDistSq !== Infinity) {
                const nearestDistDecades = Math.sqrt(minDistSq);
                const basePPD = Math.abs(yScale(10) - yScale(1));

                // 1. Scale to separate nearest neighbor
                const scaleForNeighbor = ZOOM_NEIGHBOR_DISTANCE_PX / (basePPD * nearestDistDecades);

                // 2. Scale to maximize font size (target 12px)
                // baseFS = Math.min(12, basePPD * scale);
                // To get 12px, we need basePPD * scale >= 12  =>  scale >= 12 / basePPD
                const scaleForText = 12 / basePPD;

                // Choose the larger scale (zoom in more if needed for text readability)
                targetScale = Math.max(scaleForNeighbor, scaleForText);
            } else {
                targetScale = 1000;
            }

            targetScale = Math.max(1, Math.min(targetScale, 100000));
        }

        const x = xScale(getDimensionValueX(matchItem, currentDimensionX, currentDimensionY));
        const y = yScale(valY);

        // Shift X center to the left to account for label
        // The label is to the right of the point. To center "point + label", we need to shift the Viewport Center LEFT relative to the point.

        const isRange = Array.isArray(rawDimY);
        const basePPD = Math.abs(yScale(10) - yScale(1));
        const targetPPD = basePPD * targetScale;
        // Match annotations.js: fs is capped at 12, rangeFS is fs * 1.75
        const baseFS = Math.min(12, targetPPD);
        const targetFS = isRange ? baseFS * 1.75 : baseFS;



        // _estTextWidth is a factor (char count * 0.6), need to multiply by Font Size to get pixels
        const estTextWidthFactor = matchItem._estTextWidth || 5;
        const labelWidth = estTextWidthFactor * targetFS;
        const labelGap = isRange ? 20 : 10; // Match annotations.js labelX = -thickness - 20

        // For ranges, label is on the LEFT. We shift viewport center RIGHT to accommodate.
        const centerOffsetX = isRange ? -(labelGap + labelWidth) / 2 : (labelGap + labelWidth) / 2;


        // Vertical Centering: User wants center of SCREEN, not center of container.
        // Calculate center relative to the container.
        const screenCenterY = window.innerHeight / 2;
        const containerTop = container.getBoundingClientRect().top;
        const targetCenterY = screenCenterY - containerTop;

        const targetTransform = d3.zoomIdentity
            .translate(width / 2 - centerOffsetX, targetCenterY)
            .scale(targetScale)
            .translate(-x, -y);

        svg.transition()
            .duration(750)
            .call(zoom.transform, targetTransform)
            .on("end", () => {
                if (highlight) {
                    highlightItem(matchItem);
                }
            });
    }

    return {
        update,
        highlightItem,
        unhighlightItems,
        setCallbacks,
        resize,
        zoomToItem,
        resetZoom,
        getCurrentItem: (item) => {
            if (!item) return null;
            // If the item itself exists in the raw data, use it as the base
            let baseItem = currentState.data.find(d => d.id === item.id);
            if (!baseItem) {
                // If it was a cluster, and the cluster survived (rare because IDs regenerate based on members), find it
                if (currentState.clusters) {
                    const exactCluster = currentState.clusters.find(c => c.id === item.id);
                    if (exactCluster) return exactCluster;
                }
                // If it was a cluster that broke apart, pick its first member to track
                // But only pick one that actually survived the dimension change filters!
                if (item._isCombined && item._members && item._members.length > 0) {
                    for (const m of item._members) {
                        // Check if this member survived into filteredData
                        if (currentState.filteredData && currentState.filteredData.some(fd => fd.id === m.id)) {
                            baseItem = currentState.data.find(d => d.id === m.id);
                            break;
                        }
                    }
                }
            }
            if (!baseItem) return null;

            // Now we have a real data item. Check if it's currently inside a cluster.
            if (currentState.clusters) {
                const parentCluster = currentState.clusters.find(c => c._members.some(m => m.id === baseItem.id));
                if (parentCluster) return parentCluster;
            }

            // Not inside a cluster, so it must be in the filtered data (if it passes filters)
            if (currentState.filteredData && currentState.filteredData.some(d => d.id === baseItem.id)) {
                return baseItem;
            }

            return null;
        },
        zoomTo: (transform, duration = 750, onEnd) => {
            if (duration > 0) {
                svg.transition().duration(duration).call(zoom.transform, transform).on("end", onEnd);
            } else {
                svg.call(zoom.transform, transform);
                if (onEnd) onEnd();
            }
        },
        getScales: () => {
            const t = d3.zoomTransform(svg.node());
            return { xScale: t.rescaleX(xScale), yScale: t.rescaleY(yScale), width, height };
        },
        ruler
    };
}
