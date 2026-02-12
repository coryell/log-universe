import * as d3 from 'd3';
import { fadeEnd, fadeBottomHeight } from './constants.js';
import { getDimensionValueY, getDimensionValueX, getLocalized, getFilteredData } from './utils.js';
import { updateItemAnnotations } from './annotations.js';
import { createRuler } from './ruler.js';
import { createSvgLayers } from './svgSetup.js';
import { createGrid } from './grid.js';
import { createLegend } from './legend.js';
import { applyGrouping } from './grouping.js';

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
        svg, gridGroup, xLabelGroup, yLabelGroup,
        dataLayerOuter, g, gCombined, updateMask
    } = createSvgLayers(container, width, height);

    updateMask(width, height, currentDimensionX);

    const ruler = createRuler(svg);
    const grid = createGrid(gridGroup, xLabelGroup, yLabelGroup);
    const legend = createLegend(svg, g);

    // Scales
    let yScale = d3.scaleLog().range([height - 50, 50]);
    let xScale = d3.scaleLinear();

    // Zoom Setup
    const zoom = d3.zoom()
        .scaleExtent([1, 1000000])
        .on('zoom', (event) => {
            handleZoom(event);
        });

    // Global state accessible to zoom handler
    let currentState = {
        colorScale: null,
        language: 'en-us',
        data: []
    };

    function handleZoom(event) {
        const t = event.transform;
        const domainY = yScale.domain();
        if (domainY[0] === domainY[1]) return;

        const a = 0.5;
        const domainX = xScale.domain();
        const extX0 = xScale(domainX[0]) - (a * width) / t.k;
        const extX1 = xScale(domainX[1]) + (a * width) / t.k;
        const extY0 = yScale(domainY[1]) - (a * height) / t.k;
        const extY1 = yScale(domainY[0]) + (a * height) / t.k;

        zoom.translateExtent([[extX0, extY0], [extX1, extY1]]);

        grid.updateGrid(t, { width, height, xScale, yScale, currentDimensionX, currentDimensionY });

        const newXScale = t.rescaleX(xScale);
        const newYScale = t.rescaleY(yScale);

        const currentDecadeHeight = Math.abs(newYScale(10) - newYScale(1));
        const currentFS = Math.min(12, currentDecadeHeight);
        const currentRadius = currentFS / 2.4;

        g.selectAll('.item-group')
            .attr('transform', d => `translate(${newXScale(getDimensionValueX(d, currentDimensionX, currentDimensionY))}, ${newYScale(getDimensionValueY(d, currentDimensionY))})`);
        gCombined.selectAll('.item-group')
            .attr('transform', d => {
                const first = d._members[0];
                return `translate(${newXScale(getDimensionValueX(first, currentDimensionX, currentDimensionY))}, ${newYScale(getDimensionValueY(first, currentDimensionY))})`;
            });

        const allGroups = dataLayerOuter.selectAll('.item-group');
        allGroups.selectAll('circle').attr('r', currentRadius);

        if (currentState.colorScale) {
            updateItemAnnotations(g.selectAll('.item-group'), currentRadius, currentFS, newYScale, {
                currentDimensionX, currentDimensionY, colorScale: currentState.colorScale, language: currentState.language
            });
            updateItemAnnotations(gCombined.selectAll('.item-group'), currentRadius, currentFS, newYScale, {
                currentDimensionX, currentDimensionY, colorScale: currentState.colorScale, language: currentState.language
            });
        }

        if (event.sourceEvent) {
            ruler.update({ width, height, currentDimensionX, currentDimensionY, xScale: newXScale, yScale: newYScale, event: event.sourceEvent });
        } else {
            ruler.update({ width, height, currentDimensionX, currentDimensionY, xScale: newXScale, yScale: newYScale });
        }
    }

    svg.call(zoom);

    // Recenter Wheel Logic
    let lastRecenterTime = 0;
    svg.node().addEventListener('wheel', (event) => {
        const t = d3.zoomTransform(svg.node());
        if (t.k <= 1.05 && event.deltaY > 0) {
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
    function highlightItem(d) {
        g.selectAll('.item-group').classed("highlighted", false);
        gCombined.selectAll('.item-group').classed("highlighted", false);

        if (d._isCombined) {
            gCombined.selectAll('.item-group').filter(cd => cd.id === d.id).classed("highlighted", true).raise();
            return;
        }

        let combined = null;
        gCombined.selectAll('.item-group').each(function (cd) {
            if (cd._members && cd._members.some(m => m.id === d.id)) combined = this;
        });

        if (combined) {
            d3.select(combined).classed("highlighted", true).raise();
        } else {
            g.selectAll('.item-group').filter(item => item.id === d.id).classed("highlighted", true).raise();
        }

        const t = d3.zoomTransform(svg.node());
        const currentDecadeHeight = Math.abs(t.rescaleY(yScale)(10) - t.rescaleY(yScale)(1));
        const currentFS = Math.min(12, currentDecadeHeight);
        const currentRadius = currentFS / 2.4;

        if (currentState.colorScale) {
            updateItemAnnotations(g.selectAll('.item-group'), currentRadius, currentFS, t.rescaleY(yScale), { currentDimensionX, currentDimensionY, colorScale: currentState.colorScale, language: currentState.language });
            updateItemAnnotations(gCombined.selectAll('.item-group'), currentRadius, currentFS, t.rescaleY(yScale), { currentDimensionX, currentDimensionY, colorScale: currentState.colorScale, language: currentState.language });
        }
    }

    function unhighlightItems() {
        g.selectAll('.item-group').classed("highlighted", false);
        gCombined.selectAll('.item-group').classed("highlighted", false);
        const t = d3.zoomTransform(svg.node());
        const currentDecadeHeight = Math.abs(t.rescaleY(yScale)(10) - t.rescaleY(yScale)(1));
        const currentFS = Math.min(12, currentDecadeHeight);
        const currentRadius = currentFS / 2.4;

        if (currentState.colorScale) {
            updateItemAnnotations(g.selectAll('.item-group'), currentRadius, currentFS, t.rescaleY(yScale), { currentDimensionX, currentDimensionY, colorScale: currentState.colorScale, language: currentState.language });
            updateItemAnnotations(gCombined.selectAll('.item-group'), currentRadius, currentFS, t.rescaleY(yScale), { currentDimensionX, currentDimensionY, colorScale: currentState.colorScale, language: currentState.language });
        }
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
        const padLeft = 180, padRight = 460, padTop = 60, padBottom = 120;
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

    function runGrouping() {
        applyGrouping(g, gCombined, {
            currentDimensionX, currentDimensionY,
            prevDimensionX, prevDimensionY,
            data: currentState.data,
            colorScale: currentState.colorScale,
            language: currentState.language,
            xScale, yScale, svg, zoom,
            ruler, width, height, callbacks
        });
    }

    function update(data, state) {
        // Refresh dimensions if they were 0 or on initial load
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
        const prevPositions = new Map();

        if (dimChanged && !isInitialLoad) {
            gCombined.selectAll(".item-group").remove();
            g.selectAll('.item-group').style("opacity", 1).style("pointer-events", "auto");
            g.selectAll('.item-group').each(function (d) {
                const tr = d3.select(this).attr('transform');
                if (tr) prevPositions.set(d.id, tr);
            });
        }

        const filteredData = getFilteredData(data, currentDimensionX, currentDimensionY);
        if (filteredData.length === 0) {
            g.selectAll('.item-group').remove();
            legend.updateLegend([], { ...currentState, width, height, onCategoryClick: zoomToCategory });
            return;
        }

        // Y Scale
        let minDimY = d3.min(filteredData, d => getDimensionValueY(d, currentDimensionY));
        let maxDimY = d3.max(filteredData, d => getDimensionValueY(d, currentDimensionY));
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
            const minX = d3.min(filteredData, d => getDimensionValueX(d, currentDimensionX, currentDimensionY));
            const maxX = d3.max(filteredData, d => getDimensionValueX(d, currentDimensionX, currentDimensionY));

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
            const minDimX = d3.min(filteredData, d => getDimensionValueX(d, currentDimensionX, currentDimensionY));
            const maxDimX = d3.max(filteredData, d => getDimensionValueX(d, currentDimensionX, currentDimensionY));
            xScale.domain([minDimX, maxDimX]);

            const maxCharCount = d3.max(filteredData, d => getLocalized(d.displayName, currentState.language).length) || 10;
            paddingRight = Math.max(100, maxCharCount * 12 * 0.6 + 40);

            const xDecades = Math.log10(maxDimX) - Math.log10(minDimX) || 1;
            const yDecades = Math.log10(maxDimY) - Math.log10(minDimY) || 1;
            const availW = width - paddingRight - fadeEnd;
            const availH = (height - fadeBottomHeight) - 50;
            const ppdX = availW / xDecades;
            const ppdY = availH / yDecades;
            const ppd = Math.min(ppdX, ppdY);
            const newWidth = xDecades * ppd;
            const newHeight = yDecades * ppd;
            const xOffset = (availW - newWidth) / 2;
            const yOffset = (availH - newHeight) / 2;

            xScale.range([fadeEnd + xOffset, fadeEnd + xOffset + newWidth]);
            const topPixel = 50 + yOffset;
            const bottomPixel = topPixel + newHeight;
            yScale.range([bottomPixel, topPixel]);
        }

        // Join
        const items = g.selectAll('.item-group').data(filteredData, d => d.id)
            .join(
                enter => {
                    const grp = enter.append('g').attr('class', 'item-group');
                    grp.append('rect').attr('class', 'hit-area').attr('fill', 'transparent').style('cursor', 'pointer');
                    grp.append('rect').attr('class', 'label-bg').attr('rx', 4).attr('ry', 4).attr('fill', 'black').attr('opacity', 0);
                    grp.append('rect').attr('class', 'inequality-rect').style('cursor', 'pointer').attr('opacity', 0);
                    grp.append('line').attr('class', 'range-line').style('cursor', 'pointer').attr('opacity', 0);
                    grp.append('circle').attr('cx', 0).attr('cy', 0).attr('fill', d => currentState.colorScale(getLocalized(d.category, currentState.language)));
                    grp.append('text').attr('class', 'label').attr('x', 10).attr('y', 0).attr('dy', '.35em')
                        .text(d => getLocalized(d.displayName, currentState.language))
                        .attr('fill', d => currentState.colorScale(getLocalized(d.category, currentState.language)))
                        .style('font-family', 'monospace').style('font-weight', 'bold');

                    grp.on("click", (event, d) => {
                        ruler.update({
                            width, height, currentDimensionX, currentDimensionY,
                            xScale: d3.zoomTransform(svg.node()).rescaleX(xScale),
                            yScale: d3.zoomTransform(svg.node()).rescaleY(yScale)
                        });
                        if (callbacks.onClick) callbacks.onClick(event, d);
                        event.stopPropagation();
                    })
                        .on("dblclick", (event, d) => {
                            if (callbacks.onDblClick) callbacks.onDblClick(event, d);
                            event.stopPropagation();
                        });
                    return grp;
                },
                update => update,
                exit => exit.remove()
            );

        legend.updateLegend(filteredData, { ...currentState, width, height, onCategoryClick: zoomToCategory });
        updateMask(width, height, currentDimensionX);

        if (dimChanged) {
            d3.timeout(runGrouping, 1100);
            d3.timeout(() => {
                const t = d3.zoomTransform(svg.node());
                const currentDecadeHeight = Math.abs(t.rescaleY(yScale)(10) - t.rescaleY(yScale)(1));
                const currentFS = Math.min(12, currentDecadeHeight);
                const currentRadius = currentFS / 2.4;
                updateItemAnnotations(g.selectAll('.item-group'), currentRadius, currentFS, t.rescaleY(yScale), { currentDimensionX, currentDimensionY, colorScale: currentState.colorScale, language: currentState.language });
                updateItemAnnotations(gCombined.selectAll('.item-group'), currentRadius, currentFS, t.rescaleY(yScale), { currentDimensionX, currentDimensionY, colorScale: currentState.colorScale, language: currentState.language });
            }, 1100);
        } else {
            runGrouping();
            const t = d3.zoomTransform(svg.node());
            const currentDecadeHeight = Math.abs(t.rescaleY(yScale)(10) - t.rescaleY(yScale)(1));
            const currentFS = Math.min(12, currentDecadeHeight);
            const currentRadius = currentFS / 2.4;
            updateItemAnnotations(g.selectAll('.item-group'), currentRadius, currentFS, t.rescaleY(yScale), { currentDimensionX, currentDimensionY, colorScale: currentState.colorScale, language: currentState.language });
            updateItemAnnotations(gCombined.selectAll('.item-group'), currentRadius, currentFS, t.rescaleY(yScale), { currentDimensionX, currentDimensionY, colorScale: currentState.colorScale, language: currentState.language });
        }

        isInitialLoad = false;
        prevDimensionX = currentDimensionX;
        prevDimensionY = currentDimensionY;

        // Initial Zoom
        const initialTransform = currentDimensionX === "none" ? d3.zoomIdentity.translate(-width * 0.05, 0) : d3.zoomIdentity;
        if (dimChanged) {
            svg.call(zoom.transform, initialTransform);

            // Re-apply transitions from old positions to new zoom-interpolated positions
            if (prevPositions.size > 0) {
                items.each(function (d) {
                    const prevTransform = prevPositions.get(d.id);
                    if (prevTransform) {
                        const currentTransform = d3.select(this).attr('transform');
                        if (currentTransform && currentTransform !== prevTransform) {
                            d3.select(this).attr('transform', prevTransform)
                                .transition().duration(1000).ease(d3.easeCubicOut)
                                .attr('transform', currentTransform);
                        }
                    }
                });
            }
        }
    }

    function setCallbacks(newCallbacks) {
        callbacks = { ...callbacks, ...newCallbacks };
    }

    function resize() {
        const t = d3.zoomTransform(svg.node());
        const dataX = t.rescaleX(xScale).invert(width / 2);
        const dataY = t.rescaleY(yScale).invert(height / 2);

        width = container.clientWidth;
        height = container.clientHeight;
        svg.attr('viewBox', [0, 0, width, height]);

        if (currentDimensionX !== "none") yScale.range([height - fadeBottomHeight, 50]);
        else yScale.range([height - 50, 50]);

        updateMask(width, height, currentDimensionX);
        legend.reposition(width, height);

        const newT = d3.zoomIdentity.translate(width / 2, height / 2).scale(t.k).translate(-xScale(dataX), -yScale(dataY));
        svg.call(zoom.transform, newT);
    }

    // Mouse/Touch Event Listeners
    svg.on("mousemove", (event) => {
        const t = d3.zoomTransform(svg.node());
        ruler.update({
            width, height, currentDimensionX, currentDimensionY,
            xScale: t.rescaleX(xScale), yScale: t.rescaleY(yScale), event
        });
    });

    svg.on("mouseleave", () => ruler.hide());

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

    // Touch logic (Long press)
    let touchTimer = null;
    let touchStartX = 0, touchStartY = 0, isLongPress = false;
    svg.node().addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY; isLongPress = false;
            touchTimer = setTimeout(() => {
                isLongPress = true;
                const rect = container.getBoundingClientRect();
                const mouseX = e.touches[0].clientX - rect.left;
                const mouseY = e.touches[0].clientY - rect.top;
                const t = d3.zoomTransform(svg.node());
                const newXScale = t.rescaleX(xScale);
                const newYScale = t.rescaleY(yScale);
                const xVal = newXScale.invert(mouseX);
                const yVal = newYScale.invert(mouseY);
                ruler.setMark(xVal, yVal, currentDimensionX);
                ruler.update({
                    width, height, currentDimensionX, currentDimensionY,
                    xScale: newXScale, yScale: newYScale
                });
                if (navigator.vibrate) navigator.vibrate(50);
            }, 500);
        }
    }, { passive: false });

    svg.node().addEventListener('touchmove', (e) => {
        if (touchTimer) {
            const dx = Math.abs(e.touches[0].clientX - touchStartX);
            const dy = Math.abs(e.touches[0].clientY - touchStartY);
            if (dx > 10 || dy > 10) { clearTimeout(touchTimer); touchTimer = null; }
        }
    }, { passive: false });

    svg.node().addEventListener('touchend', () => { if (touchTimer) clearTimeout(touchTimer); });

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

            const domainY = yScale.domain();
            const totalDecades = Math.log10(domainY[1]) - Math.log10(domainY[0]);
            const availableHeight = height - 100;

            let targetScale = (height * totalDecades) / (3 * availableHeight);

            // Dynamic Zoom Constraint based on neighbors
            const filteredData = getFilteredData(currentState.data || []);
            const neighbors = filteredData.filter(d => Math.abs(getDimensionValueY(d, currentDimensionY) - valY) < valY * 2);

            let minDiff = Infinity;
            const y1 = yScale(valY);

            neighbors.forEach(p => {
                if (p.id === matchItem.id) return;
                const y2 = yScale(getDimensionValueY(p, currentDimensionY));
                const diff = Math.abs(y1 - y2);
                if (diff < minDiff) minDiff = diff;
            });

            if (minDiff !== Infinity) {
                const safeRadius = Math.min(width, height) / 2.2;
                const maxScaleForNeighbor = safeRadius / minDiff;
                targetScale = Math.min(targetScale, maxScaleForNeighbor);
            }

            // Constraint for ranges
            if (Array.isArray(rawDimY)) {
                const y1_raw = yScale(Number(rawDimY[0]));
                const y2_raw = yScale(Number(rawDimY[1]));
                const deltaY = Math.abs(y1_raw - y2_raw);
                if (deltaY > 0) {
                    const rangeScale = (availableHeight * 0.7) / deltaY;
                    targetScale = Math.min(targetScale, rangeScale);
                }
            }

            targetScale = Math.max(1, Math.min(targetScale, 1000));

            const x = xScale(getDimensionValueX(matchItem, currentDimensionX, currentDimensionY));
            const y = yScale(valY);

            const targetTransform = d3.zoomIdentity
                .translate(width / 2, height / 2)
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
