import * as d3 from 'd3';
import { fadeEnd, fadeBottomHeight, DOUBLE_CLICK_THRESHOLD } from './constants.js';
import { getDimensionValueY, getDimensionValueX, getLocalized, getFilteredData } from './utils.js';
import { setupItemAnnotations, updateAnnotationLayout } from './annotations.js';
import { createRuler } from './ruler.js';
import { createSvgLayers } from './svgSetup.js';
import { createGrid } from './grid.js';
import { createLegend } from './legend.js';
import { getClusters } from './grouping.js';

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

    // SVG setup (gradients, masks, layer groups)
    const {
        svg, gridGroup, xLabelGroup, yLabelGroup, mobileMask,
        dataLayerOuter, g, gCombined, updateMask
    } = createSvgLayers(container, width, height);

    function checkMobile() {
        return window.matchMedia('(max-width: 768px)').matches;
    }

    updateMask(width, height, currentDimensionX, checkMobile());

    const ruler = createRuler(svg, checkMobile);
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

    /**
     * Core Render Loop
     * Renders items and clusters that are visible within the current view.
     */
    function render(t, event) {
        // 1. Rescale Scales
        const newXScale = t.rescaleX(xScale);
        const newYScale = t.rescaleY(yScale);

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
            // Binary search for Y range since data is sorted by _cachedY in update()
            const idxStart = bisector(data, yMin);
            const idxEnd = bisector(data, yMax);
            const yRange = data.slice(idxStart, idxEnd);

            // X-visibility still O(K) where K is sub-array length
            const result = [];
            for (let i = 0; i < yRange.length; i++) {
                const d = yRange[i];
                if (d._cachedX >= xMin && d._cachedX <= xMax) {
                    result.push(d);
                }
            }
            return result;
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

        // 6. Join & Render - Individual Items (g)
        g.selectAll('.item-group').data(visibleData, d => d.id)
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
                        const isDoubleClick = (d.id === currentState.lastClickId) && ((now - currentState.lastClickTime) < 300);

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
            .attr('transform', d => `translate(${newXScale(d._cachedX)}, ${newYScale(d._cachedY)})`)
            .style('opacity', d => currentState.hiddenIds.has(d.id) ? 0 : null) // Hide clustered items
            .style('pointer-events', d => currentState.hiddenIds.has(d.id) ? 'none' : null);

        // Update annotation setup for existing items if layout changed (e.g. dimensions flipped)
        // Optimization: Only run this on the subset that needs it. 
        // We do this via .each check.
        const itemSelection = g.selectAll('.item-group');
        itemSelection.each(function (d) {
            if (this._layoutVersion !== currentState.layoutVersion) {
                setupItemAnnotations(d3.select(this), {
                    currentDimensionX, currentDimensionY,
                    colorScale: currentState.colorScale,
                    language: currentState.language
                });
                this._layoutVersion = currentState.layoutVersion;
            }
        });

        // Update Dynamic Layout (Scale/Radius dependent)
        itemSelection.select('circle').attr('r', currentRadius);
        updateAnnotationLayout(itemSelection, currentRadius, currentFS, newYScale);


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
                        .style('font-family', 'monospace');

                    // Build tspans ONCE on enter
                    grp.each(function (d) {
                        const el = d3.select(this);
                        const textEl = el.select('.label');
                        d._members.forEach((m, i) => {
                            const name = getLocalized(m.displayName, currentState.language);
                            const cat = getLocalized(m.category, currentState.language);
                            textEl.append('tspan').text(name).attr('fill', currentState.colorScale(cat));
                            if (i < d._members.length - 1) {
                                const nextCat = getLocalized(d._members[i + 1].category, currentState.language);
                                textEl.append('tspan').text(' / ').attr('fill', currentState.colorScale(nextCat));
                            }
                        });

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
            .attr('transform', d => `translate(${newXScale(d._cachedX)}, ${newYScale(d._cachedY)})`);

        // Update content of groups... 
        const clusterSelection = gCombined.selectAll('.item-group.combined');

        // Check for layout updates needed on clusters
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

        // 9. Ruler Update
        ruler.update({
            width, height, currentDimensionX, currentDimensionY,
            xScale: newXScale, yScale: newYScale,
            event: checkMobile() ? undefined : event
        });
    }

    function handleZoom(event) {
        const t = event.transform;
        render(t, event.sourceEvent);
    }

    svg.call(zoom)
        .on("dblclick.zoom", null); // Disable double-click to zoom

    // Recenter Wheel Logic
    let lastRecenterTime = 0;
    svg.node().addEventListener('wheel', (event) => {
        const t = d3.zoomTransform(svg.node());
        if (t.k <= minZoom * 1.05 && event.deltaY > 0) {
            const now = Date.now();
            if (now - lastRecenterTime > 1500) {
                lastRecenterTime = now;
                if (currentDimensionX === "none") {
                    svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity.translate(-width * 0.05, 0));
                } else {
                    svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
                }
            }
        }
    }, { capture: true, passive: true });

    // Helper: Highlight
    // Needs to work even if item is not currently rendered (if possible)? 
    // Actually, if we search for something and zoom to it, we render it.
    // If we highlight something off screen, it won't exist.
    // But typically we zoom to it first.
    function highlightItem(d) {
        // We can only class existing items
        g.selectAll('.item-group').classed("highlighted", false);
        gCombined.selectAll('.item-group').classed("highlighted", false);

        // If it's a combined item (from search result or internal logic)
        if (d._isCombined) {
            gCombined.selectAll('.item-group.combined').filter(cd => cd.id === d.id).classed("highlighted", true).raise();
            // Force re-render of layout for this item to pick up highlight color
            render(d3.zoomTransform(svg.node()));
            return;
        }

        // Check if item is inside a cluster
        let parentClusterId = null;
        // Search clusters to see if d is a member
        const clusters = currentState.clusters;
        const parent = clusters.find(c => c._members.some(m => m.id === d.id));
        if (parent) parentClusterId = parent.id;

        if (parentClusterId) {
            gCombined.selectAll('.item-group.combined').filter(cd => cd.id === parentClusterId).classed("highlighted", true).raise();
        } else {
            g.selectAll('.item-group').filter(item => item.id === d.id).classed("highlighted", true).raise();
        }

        // Re-render to apply color changes (highlight = white)
        render(d3.zoomTransform(svg.node()));
    }

    function unhighlightItems() {
        g.selectAll('.item-group').classed("highlighted", false);
        gCombined.selectAll('.item-group').classed("highlighted", false);
        render(d3.zoomTransform(svg.node()));
    }

    function zoomToCategory(cat) {
        const data = currentState.data || [];
        const language = currentState.language;
        let categoryData;
        if (currentDimensionX === "none") {
            categoryData = data.filter(item => getLocalized(item.category, language) === cat && item.dimensions[currentDimensionY] !== undefined);
        } else {
            categoryData = data.filter(item => getLocalized(item.category, language) === cat && item.dimensions[currentDimensionY] !== undefined && item.dimensions[currentDimensionX] !== undefined);
        }
        if (categoryData.length === 0) return;

        const xValues = categoryData.map(d => xScale(getDimensionValueX(d, currentDimensionX, currentDimensionY)));
        const yValues = categoryData.map(d => yScale(getDimensionValueY(d, currentDimensionY)));

        const minX = d3.min(xValues);
        const maxX = d3.max(xValues);
        const minY = d3.min(yValues);
        const maxY = d3.max(yValues);

        const boundsWidth = maxX - minX;
        const boundsHeight = maxY - minY;
        const padLeft = Math.min(180, width * 0.1);
        const padRight = Math.min(460, width * 0.1);
        const padTop = Math.min(60, height * 0.05);
        const padBottom = Math.min(120, height * 0.1);
        const availWidth = width - padLeft - padRight;
        const availHeight = height - padTop - padBottom;

        let scaleX = boundsWidth > 0 ? availWidth / boundsWidth : 10000;
        let scaleY = boundsHeight > 0 ? availHeight / boundsHeight : 10000;
        let scale = Math.min(Math.max(Math.min(scaleX, scaleY), 1), 10000);

        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const screenCX = padLeft + availWidth / 2;
        const screenCY = padTop + availHeight / 2;

        const translate = [screenCX - cx * scale, screenCY - cy * scale];
        svg.transition().duration(750)
            .call(zoom.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale));
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

        // Optimization: Calculate filteredData, increment version, and CACHE VALUES

        const filteredData = getFilteredData(data, currentDimensionX, currentDimensionY);
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
            // Font size at zoom=1: min(12, basDecadeHeight)
            const baseDecadeHeight = Math.abs(yScale(10) - yScale(1));
            const baseFS = Math.min(12, baseDecadeHeight);
            const labelGap = 10; // gap between point and label

            let dataMinX = Infinity, dataMaxX = -Infinity;
            let dataMinY = Infinity, dataMaxY = -Infinity;
            for (const d of allPoints) {
                const px = xScale(d._cachedX);
                const py = yScale(d._cachedY);
                const labelW = labelGap + (d._estTextWidth || 0) * baseFS;
                if (px < dataMinX) dataMinX = px;
                if (px + labelW > dataMaxX) dataMaxX = px + labelW;
                if (py < dataMinY) dataMinY = py;
                if (py > dataMaxY) dataMaxY = py;
            }
            const dataW = dataMaxX - dataMinX || 1;
            const dataH = dataMaxY - dataMinY || 1;
            const padding = 0.8; // data should fill at most 80% of viewport when fully zoomed out
            const fitScaleX = (width * padding) / dataW;
            const fitScaleY = (height * padding) / dataH;
            minZoom = Math.max(0.01, Math.min(fitScaleX, fitScaleY, 1));
            zoom.scaleExtent([minZoom, 1000000]);
        }

        // Calculate Hidden IDs
        const hiddenIds = new Set();
        clusters.forEach(c => {
            c._members.forEach(m => hiddenIds.add(m.id));
        });
        currentState.hiddenIds = hiddenIds;

        legend.updateLegend(filteredData, { ...currentState, width, height, onCategoryClick: zoomToCategory });
        updateMask(width, height, currentDimensionX, checkMobile());

        isInitialLoad = false;
        prevDimensionX = currentDimensionX;
        prevDimensionY = currentDimensionY;

        const initialTransform = currentDimensionX === "none" ? d3.zoomIdentity.translate(-width * 0.05, 0) : d3.zoomIdentity;

        if (dimChanged) {
            svg.call(zoom.transform, initialTransform);
        } else {
            render(d3.zoomTransform(svg.node()));
        }
    }

    // ... (rest of function remains same structure, just updated content above covers it) ...
    // Note: The previous logic for resize/setCallbacks/listeners was included in the replacement content block above.

    function setCallbacks(newCallbacks) { callbacks = { ...callbacks, ...newCallbacks }; }
    function resize() {
        const t = d3.zoomTransform(svg.node());
        const dataX = t.rescaleX(xScale).invert(width / 2);
        const dataY = t.rescaleY(yScale).invert(height / 2);

        width = container.clientWidth;
        height = container.clientHeight;
        svg.attr('viewBox', [0, 0, width, height]);

        if (currentDimensionX !== "none") yScale.range([height - fadeBottomHeight, 50]);
        else yScale.range([height - 50, 50]);

        updateMask(width, height, currentDimensionX, checkMobile());
        legend.reposition(width, height);

        const newT = d3.zoomIdentity.translate(width / 2, height / 2).scale(t.k).translate(-xScale(dataX), -yScale(dataY));
        svg.call(zoom.transform, newT);
    }

    svg.on("mousemove", (event) => {
        if (checkMobile()) return;
        const t = d3.zoomTransform(svg.node());
        ruler.update({
            width, height, currentDimensionX, currentDimensionY,
            xScale: t.rescaleX(xScale), yScale: t.rescaleY(yScale), event
        });
    });

    svg.on("mouseleave", () => {
        const isMobile = checkMobile();
        if (!isMobile) ruler.hide();
    });

    svg.on("click", (e) => {
        const isMobile = checkMobile();
        if (isMobile) ruler.hide();
    }); // Hide ruler on background click/tap (mobile only)

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

    return {
        update,
        highlightItem,
        unhighlightItems,
        setCallbacks,
        resize,
        zoomToItem: (item) => {
            const matchItem = currentState.data.find(d => d.id === item.id);
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
                    const currentZoom = d3.zoomTransform(svg.node()).k;
                    // deltaY is in *pixels* at current zoom.
                    // We want deltaY * (targetScale / currentZoom) = availableHeight * 0.7
                    // So targetScale = (availableHeight * 0.7 * d3.zoomTransform(svg.node()).k) / deltaY
                    targetScale = (availableHeight * 0.7 * d3.zoomTransform(svg.node()).k) / deltaY;
                } else {
                    targetScale = 1000; // Fallback
                }
            }
            targetScale = Math.max(1, Math.min(targetScale, 1000)); // Lower cap for ranges

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

                    const currentTransform = d3.zoomTransform(svg.node());
                    // Assume yScale is the rescaled scale (current zoom applied)

                    const basePPD = Math.abs(yScale(10) - yScale(1));
                    const currentPPD = basePPD * currentTransform.k;
                    const currentPixelDist = currentPPD * nearestDistDecades;

                    targetScale = currentTransform.k * (30 / currentPixelDist);
                } else {
                    targetScale = 1000;
                }

                targetScale = Math.max(1, Math.min(targetScale, 100000));
            }

            const x = xScale(getDimensionValueX(matchItem, currentDimensionX, currentDimensionY));
            const y = yScale(valY);

            // Shift X center to the left to account for label
            // The label is to the right of the point. To center "point + label", we need to shift the Viewport Center LEFT relative to the point.

            // Calculate expected font size at target zoom (capped at 12px, matching render logic)
            const basePPD = Math.abs(yScale(10) - yScale(1));
            const targetPPD = basePPD * targetScale;
            const targetFS = Math.min(12, targetPPD);

            // _estTextWidth is a factor (char count * 0.6), need to multiply by Font Size to get pixels
            const estTextWidthFactor = matchItem._estTextWidth || 5;
            const labelWidth = estTextWidthFactor * targetFS;
            const labelGap = 10;


            const centerOffsetX = (labelGap + labelWidth) / 2;

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
                .on("end", () => highlightItem(matchItem));
        },
        resetZoom: () => {
            if (currentDimensionX === "none") {
                svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity.translate(-width * 0.05, 0));
            } else {
                svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
            }
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
