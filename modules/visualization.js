import * as d3 from 'd3';
import { paddingLeft, fadeEnd, fadeBottomHeight, paddingBottom, colors } from './constants.js';
import { getUnit, getDimensionValueY, getDimensionValueX, getLocalized, getFilteredData } from './utils.js';
import { updateItemAnnotations } from './annotations.js';
import { createRuler } from './ruler.js';

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

    const svg = d3.select(container)
        .append('svg')
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('viewBox', [0, 0, width, height]);

    // Define Gradients and Masks
    const defs = svg.append("defs");

    const gradient = defs.append("linearGradient")
        .attr("id", "fade-gradient")
        .attr("gradientUnits", "userSpaceOnUse")
        .attr("x1", 0)
        .attr("x2", fadeEnd)
        .attr("y1", 0)
        .attr("y2", 0);

    gradient.append("stop")
        .attr("offset", paddingLeft / fadeEnd)
        .attr("stop-color", "black");

    gradient.append("stop")
        .attr("offset", "1")
        .attr("stop-color", "white");

    const verticalGradient = defs.append("linearGradient")
        .attr("id", "fade-gradient-vertical")
        .attr("gradientUnits", "userSpaceOnUse")
        .attr("x1", 0)
        .attr("x2", 0)
        .attr("y1", height)
        .attr("y2", height - fadeBottomHeight);

    verticalGradient.append("stop")
        .attr("offset", 0)
        .attr("stop-color", "black");

    verticalGradient.append("stop")
        .attr("offset", paddingBottom / fadeBottomHeight)
        .attr("stop-color", "black");

    verticalGradient.append("stop")
        .attr("offset", "1")
        .attr("stop-color", "white");

    const maskLeft = defs.append("mask")
        .attr("id", "fade-mask-left");

    const maskBottom = defs.append("mask")
        .attr("id", "fade-mask-bottom");

    const createInequalityMask = (id, x1, y1, x2, y2) => {
        const gradId = id + "-grad";
        const grad = defs.append("linearGradient")
            .attr("id", gradId)
            .attr("x1", x1)
            .attr("y1", y1)
            .attr("x2", x2)
            .attr("y2", y2);
        grad.append("stop").attr("offset", "0%").attr("stop-color", "white").attr("stop-opacity", 1);
        grad.append("stop").attr("offset", "10%").attr("stop-color", "white").attr("stop-opacity", 1);
        grad.append("stop").attr("offset", "100%").attr("stop-color", "white").attr("stop-opacity", 0);

        defs.append("mask")
            .attr("id", id)
            .attr("maskContentUnits", "objectBoundingBox")
            .append("rect")
            .attr("x", 0)
            .attr("y", 0)
            .attr("width", 1)
            .attr("height", 1)
            .attr("fill", `url(#${gradId})`);
    };

    createInequalityMask("ineq-fade", "0%", "0%", "100%", "0%");

    function updateMask() {
        maskLeft.selectAll("rect").remove();
        maskBottom.selectAll("rect").remove();

        maskLeft.append("rect")
            .attr("x", 0)
            .attr("y", 0)
            .attr("width", fadeEnd)
            .attr("height", height)
            .attr("fill", "url(#fade-gradient)");

        maskLeft.append("rect")
            .attr("x", fadeEnd)
            .attr("y", 0)
            .attr("width", width - fadeEnd)
            .attr("height", height)
            .attr("fill", "white");

        if (currentDimensionX !== "none") {
            svg.select("#fade-gradient-vertical")
                .attr("y1", height)
                .attr("y2", height - fadeBottomHeight);

            maskBottom.append("rect")
                .attr("x", 0)
                .attr("y", height - fadeBottomHeight)
                .attr("width", width)
                .attr("height", fadeBottomHeight)
                .attr("fill", "url(#fade-gradient-vertical)");

            maskBottom.append("rect")
                .attr("x", 0)
                .attr("y", 0)
                .attr("width", width)
                .attr("height", height - fadeBottomHeight)
                .attr("fill", "white");
        } else {
            maskBottom.append("rect")
                .attr("x", 0)
                .attr("y", 0)
                .attr("width", width)
                .attr("height", height)
                .attr("fill", "white");
        }
    }

    updateMask();

    const ruler = createRuler(svg);

    const gridGroup = svg.append("g").attr("class", "grid");
    const xLabelGroup = svg.append("g")
        .attr("class", "x-axis-labels")
        .attr("mask", "url(#fade-mask-left)");
    const yLabelGroup = svg.append("g")
        .attr("class", "y-axis-labels")
        .attr("mask", "url(#fade-mask-bottom)");

    const dataLayerOuter = svg.append('g')
        .attr("class", "data-layer-outer")
        .attr("mask", "url(#fade-mask-left)");

    const g = dataLayerOuter.append('g')
        .attr("class", "data-layer")
        .attr("mask", "url(#fade-mask-bottom)");

    const gCombined = dataLayerOuter.append('g')
        .attr("class", "combined-layer")
        .attr("mask", "url(#fade-mask-bottom)");

    // Scales
    let yScale = d3.scaleLog().range([height - 50, 50]);
    let xScale = d3.scaleLinear();

    // Legend setup
    const legendPadding = 15;
    const legendItemHeight = 20;
    const legend = svg.append("g").attr("class", "legend");
    let legendWidth = 0;
    let legendHeight = 0;

    // Zoom Setup
    const zoom = d3.zoom()
        .scaleExtent([1, 1000000])
        .on('zoom', (event) => {
            // ... existing zoom logic ...
            // Need access to colorScale and language from update context or state
            // For now, let's assume they are available via closure or passed config.
            // Refactoring strategy: Zoom handler needs access to current scales and state.
            handleZoom(event);
        });

    // We need to store global state accessible to zoom handler
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

        updateGrid(t);

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
                currentDimensionX,
                currentDimensionY,
                colorScale: currentState.colorScale,
                language: currentState.language
            });
            updateItemAnnotations(gCombined.selectAll('.item-group'), currentRadius, currentFS, newYScale, {
                currentDimensionX,
                currentDimensionY,
                colorScale: currentState.colorScale,
                language: currentState.language
            });
        }

        if (event.sourceEvent) {
            ruler.update({
                width, height,
                currentDimensionX, currentDimensionY,
                xScale: newXScale, yScale: newYScale,
                event: event.sourceEvent
            });
        } else {
            ruler.update({
                width, height,
                currentDimensionX, currentDimensionY,
                xScale: newXScale, yScale: newYScale
            });
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

    const updateGrid = (transform) => {
        const newYScale = transform.rescaleY(yScale);
        const newXScale = transform.rescaleX(xScale);
        const padding = 200;

        xLabelGroup.selectAll(".x-label").remove();
        yLabelGroup.selectAll(".y-label").remove();

        // Y Axis Grid
        const yStart = newYScale.invert(height + padding);
        const yEnd = newYScale.invert(-padding);
        const paddedYScale = newYScale.copy().domain([d3.min([yStart, yEnd]), d3.max([yStart, yEnd])]);
        let yTickValues = paddedYScale.ticks(15, "~e");
        const hasSubTenY = yTickValues.some(d => !Number.isInteger(Math.log10(d)));
        const majorYDecades = new Set();
        yTickValues.forEach(d => { if (Number.isInteger(Math.log10(d))) majorYDecades.add(d); });

        if (!hasSubTenY) {
            const logMin = Math.ceil(Math.log10(d3.min([yStart, yEnd])));
            const logMax = Math.floor(Math.log10(d3.max([yStart, yEnd])));
            const allYDecades = [];
            for (let i = logMin; i <= logMax; i++) allYDecades.push(Math.pow(10, i));
            yTickValues = Array.from(new Set([...yTickValues, ...allYDecades])).sort((a, b) => a - b);
        }

        gridGroup.selectAll(".horizontal-grid").data([null]).join("g")
            .attr("class", "horizontal-grid")
            .call(d3.axisRight(newYScale)
                .tickValues(yTickValues)
                .tickSize(width)
                .tickFormat(d => {
                    const log10 = Math.log10(d);
                    if (majorYDecades.has(d)) return `10^${log10} ${getUnit(currentDimensionY)}`;
                    return "";
                })
            );
        gridGroup.select(".horizontal-grid .domain").remove();

        // X Axis Grid
        gridGroup.selectAll(".vertical-grid").data([null]).join("g").attr("class", "vertical-grid");

        if (currentDimensionX === "none") {
            const decadeHeight = Math.abs(newYScale(10) - newYScale(1));
            const mainYTicks = yTickValues.filter(d => majorYDecades.has(d));
            let stride = 1;
            if (mainYTicks.length >= 2) {
                stride = Math.abs(Math.round(Math.log10(mainYTicks[1])) - Math.round(Math.log10(mainYTicks[0])));
            }
            const xZero = newXScale.invert(0);
            const xDist = newXScale.invert(decadeHeight) - xZero;
            const spacing = Math.abs(xDist) * stride;
            const xTicks = [];
            const xMinPadded = newXScale.invert(-padding);
            const xMaxPadded = newXScale.invert(width + padding);
            if (spacing > 0 && isFinite(spacing)) {
                const start = Math.ceil(xMinPadded / spacing) * spacing;
                let current = start;
                const safetyLimit = 1000;
                let count = 0;
                while (current <= xMaxPadded && count < safetyLimit) {
                    xTicks.push(current);
                    current += spacing;
                    count++;
                }
            }
            gridGroup.select(".vertical-grid")
                .call(d3.axisBottom(newXScale).tickValues(xTicks).tickFormat("").tickSize(height));
            gridGroup.selectAll(".vertical-grid .tick line")
                .attr("stroke", "#00aaff").attr("stroke-opacity", 0.4).attr("stroke-dasharray", "2,2");
            gridGroup.selectAll(".vertical-grid .tick text").remove();

        } else {
            const xStart = newXScale.invert(-padding);
            const xEnd = newXScale.invert(width + padding);
            const paddedXScale = newXScale.copy().domain([d3.min([xStart, xEnd]), d3.max([xStart, xEnd])]);
            let xTickValues = paddedXScale.ticks(15, "~e");
            const hasSubTenX = xTickValues.some(d => !Number.isInteger(Math.log10(d)));
            const majorXDecades = new Set();
            xTickValues.forEach(d => { if (Number.isInteger(Math.log10(d))) majorXDecades.add(d); });

            if (!hasSubTenX) {
                const logMin = Math.ceil(Math.log10(d3.min([xStart, xEnd])));
                const logMax = Math.floor(Math.log10(d3.max([xStart, xEnd])));
                const allXDecades = [];
                for (let i = logMin; i <= logMax; i++) allXDecades.push(Math.pow(10, i));
                xTickValues = Array.from(new Set([...xTickValues, ...allXDecades])).sort((a, b) => a - b);
            }

            gridGroup.select(".vertical-grid")
                .call(d3.axisBottom(newXScale).tickValues(xTickValues).tickSize(height).tickFormat(d => {
                    const log10 = Math.log10(d);
                    if (majorXDecades.has(d)) return `10^${log10} ${getUnit(currentDimensionX)}`;
                    return "";
                }));

            gridGroup.selectAll(".vertical-grid .tick line")
                .attr("stroke", "#00aaff").attr("stroke-dasharray", "2,2")
                .attr("stroke-opacity", d => (majorXDecades.has(d)) ? 0.4 : 0.25);

            gridGroup.selectAll(".vertical-grid .tick text").each(function (d) {
                const xPos = newXScale(d);
                const log10 = Math.log10(d);
                if (majorXDecades.has(d)) {
                    xLabelGroup.append("text").attr("class", "x-label").attr("x", xPos).attr("y", height - 20)
                        .attr("text-anchor", "middle").attr("fill", "#00aaff").style("font-family", "monospace").style("font-size", "12px")
                        .text(`10^${log10} ${getUnit(currentDimensionX)}`);
                }
            });
            gridGroup.selectAll(".vertical-grid .tick text").attr("opacity", 0);
        }
        gridGroup.select(".vertical-grid .domain").remove();
        gridGroup.selectAll(".horizontal-grid .tick line")
            .attr("stroke", "#00aaff").attr("stroke-dasharray", "2,2")
            .attr("stroke-opacity", d => (majorYDecades.has(d)) ? 0.4 : 0.25);

        if (currentDimensionX !== "none") {
            gridGroup.selectAll(".horizontal-grid .tick text").each(function (d) {
                const yPos = newYScale(d);
                const log10 = Math.log10(d);
                if (majorYDecades.has(d)) {
                    yLabelGroup.append("text").attr("class", "y-label").attr("x", 10).attr("y", yPos - 4)
                        .attr("fill", "#00aaff").style("font-family", "monospace").style("font-size", "12px")
                        .text(`10^${log10} ${getUnit(currentDimensionY)}`);
                }
            });
            gridGroup.selectAll(".horizontal-grid .tick text").attr("opacity", 0);
        } else {
            gridGroup.selectAll(".horizontal-grid .tick text").attr("x", 10).attr("dy", -4).attr("fill", "#00aaff")
                .attr("opacity", d => majorYDecades.has(d) ? 1.0 : 0).style("font-family", "monospace").style("font-size", "12px");
        }
    };

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


    function applyGrouping() {
        if (currentDimensionX !== prevDimensionX || currentDimensionY !== prevDimensionY || !currentState.data) return;
        gCombined.selectAll(".item-group").remove();

        const groups = new Map();
        const filteredData = getFilteredData(currentState.data || [], currentDimensionX, currentDimensionY);

        filteredData.forEach(d => {
            let key = "";
            if (currentDimensionX === "none") {
                key = `y:${d._orig_dimensions[currentDimensionY]}|x:${d._orig_x_coordinates[currentDimensionY]}`;
            } else {
                key = `y:${d._orig_dimensions[currentDimensionY]}|x:${d._orig_dimensions[currentDimensionX]}`;
            }
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(d);
        });

        groups.forEach((members, key) => {
            if (members.length > 1) {
                members.forEach(m => {
                    g.selectAll(".item-group").filter(d => d.id === m.id).style("opacity", 0).style("pointer-events", "none");
                });

                const first = members[0];
                const combinedDisplayName = members.map(m => getLocalized(m.displayName, currentState.language)).join(" / ");
                const combinedData = {
                    ...first,
                    id: `combined-${key}`,
                    displayName: { [currentState.language]: combinedDisplayName },
                    _isCombined: true,
                    _members: members
                };

                const t = d3.zoomTransform(svg.node());
                const newXScale = t.rescaleX(xScale);
                const newYScale = t.rescaleY(yScale);
                const currentDecadeHeight = Math.abs(newYScale(10) - newYScale(1));
                const currentFS = Math.min(12, currentDecadeHeight);
                const currentRadius = currentFS / 2.4;

                const grp = gCombined.append("g")
                    .datum(combinedData)
                    .attr("class", "item-group combined")
                    .attr("transform", `translate(${newXScale(getDimensionValueX(first, currentDimensionX, currentDimensionY))}, ${newYScale(getDimensionValueY(first, currentDimensionY))})`);

                grp.append('rect').attr('class', 'hit-area')
                    .attr('fill', 'transparent').style('cursor', 'pointer')
                    .attr('x', -currentRadius - 5).attr('y', -currentFS)
                    .attr('height', currentFS * 2).attr('width', (combinedDisplayName.length * currentFS * 0.6 + currentRadius + 20));

                grp.append('rect').attr('class', 'label-bg')
                    .attr('rx', 4).attr('ry', 4).attr('fill', 'black').attr('opacity', 0)
                    .attr('x', 8).attr('y', -currentFS * 0.7).attr('height', currentFS * 1.5).attr('width', (combinedDisplayName.length * currentFS * 0.6 + 6));

                grp.append('rect').attr('class', 'inequality-rect').style('cursor', 'pointer').attr('opacity', 0);

                grp.append('circle').attr('cx', 0).attr('cy', 0).attr('r', currentRadius)
                    .attr('fill', currentState.colorScale(getLocalized(first.category, currentState.language)));

                const textEl = grp.append('text').attr('class', 'label')
                    .attr('x', 10).attr('y', 0).attr('dy', '.35em')
                    .style('font-family', 'monospace').style('font-size', `${currentFS}px`);

                members.forEach((m, i) => {
                    const name = getLocalized(m.displayName, currentState.language);
                    const cat = getLocalized(m.category, currentState.language);
                    textEl.append('tspan').text(name).attr('fill', currentState.colorScale(cat));
                    if (i < members.length - 1) {
                        const nextCat = getLocalized(members[i + 1].category, currentState.language);
                        textEl.append('tspan').text(' / ').attr('fill', currentState.colorScale(nextCat));
                    }
                });

                grp.on("click", (event) => {
                    ruler.update({
                        width, height, currentDimensionX, currentDimensionY,
                        xScale: d3.zoomTransform(svg.node()).rescaleX(xScale),
                        yScale: d3.zoomTransform(svg.node()).rescaleY(yScale)
                    });
                    if (callbacks.onClick) callbacks.onClick(event, combinedData);
                    event.stopPropagation();
                });
            }
        });
    }

    function updateLegend(currentData) {
        if (!currentState.categories) return; // Need categories list
        const activeCats = currentState.categories.filter(cat =>
            currentData.some(d => getLocalized(d.category, currentState.language) === cat)
        );

        legendHeight = activeCats.length * legendItemHeight + legendPadding * 2;
        const texts = legend.selectAll("text").data(activeCats, d => d);
        texts.exit().remove();

        const textEnter = texts.enter().append("text")
            .attr("x", legendPadding).attr("dy", "0.35em")
            .style("font-family", "monospace").style("font-size", "12px").style("cursor", "pointer")
            .attr("fill", d => currentState.colorScale ? currentState.colorScale(d) : 'black');

        const textMerge = textEnter.merge(texts)
            .attr("y", (d, i) => legendPadding + i * legendItemHeight + legendItemHeight / 2)
            .text(d => d);

        textEnter.on("mouseover", function (event, cat) {
            g.selectAll(".item-group").transition().duration(200)
                .attr("opacity", d => getLocalized(d.category, currentState.language) === cat ? 1 : 0.2);
            g.selectAll(".item-group").filter(d => getLocalized(d.category, currentState.language) === cat).raise();
        })
            .on("mouseout", function () {
                g.selectAll(".item-group").transition().duration(200).attr("opacity", 1);
                g.selectAll(".item-group").sort((a, b) => d3.ascending(a.id, b.id));
            });
        // Click implementation for legend filtering would go here or be callback-based

        let maxTextWidth = 0;
        textMerge.each(function () {
            const bbox = this.getComputedTextLength();
            if (bbox > maxTextWidth) maxTextWidth = bbox;
        });
        legendWidth = maxTextWidth + legendPadding * 2;
        let rect = legend.select("rect");
        if (rect.empty()) rect = legend.insert("rect", "text").attr("fill", "black").attr("stroke", "#00aaff").attr("stroke-width", 1).attr("rx", 5).attr("ry", 5);
        rect.attr("width", legendWidth).attr("height", legendHeight);

        const legendX = width - legendWidth - 20;
        const legendY = height - legendHeight - 60;
        legend.attr("transform", `translate(${legendX}, ${legendY})`);
    }

    function update(data, state) {
        // Refresh dimensions if they were 0 or on initial load
        if (width === 0 || height === 0 || isInitialLoad) {
            width = container.clientWidth;
            height = container.clientHeight;
            if (width > 0 && height > 0) {
                svg.attr('viewBox', [0, 0, width, height]);
                // Re-initialize any coordinate-dependent values
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
            updateLegend([]);
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


        updateLegend(filteredData);
        updateMask();

        if (dimChanged) {
            d3.timeout(applyGrouping, 1100);
            d3.timeout(() => {
                const t = d3.zoomTransform(svg.node());
                const currentDecadeHeight = Math.abs(t.rescaleY(yScale)(10) - t.rescaleY(yScale)(1));
                const currentFS = Math.min(12, currentDecadeHeight);
                const currentRadius = currentFS / 2.4;
                updateItemAnnotations(g.selectAll('.item-group'), currentRadius, currentFS, t.rescaleY(yScale), { currentDimensionX, currentDimensionY, colorScale: currentState.colorScale, language: currentState.language });
                updateItemAnnotations(gCombined.selectAll('.item-group'), currentRadius, currentFS, t.rescaleY(yScale), { currentDimensionX, currentDimensionY, colorScale: currentState.colorScale, language: currentState.language });
            }, 1100);
        } else {
            applyGrouping();
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

        // Update Ruler
        if (currentState.colorScale) { // Ensure state is ready
            // Just trigger an update to sync lines
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

        updateMask();
        const legendX = width - legendWidth - 20;
        const legendY = height - legendHeight - 60;
        legend.attr("transform", `translate(${legendX}, ${legendY})`);

        const newT = d3.zoomIdentity.translate(width / 2, height / 2).scale(t.k).translate(-xScale(dataX), -yScale(dataY));
        svg.call(zoom.transform, newT);
    }

    // Event Listeners for Interaction (Hover/Mousemove handled via D3/zoom, but global mousemove/ruler needs listeners)
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
                ? Math.sqrt(Number(rawDimY[0]) * Number(rawDimY[1])) // Geometric mean for range center
                : getDimensionValueY(matchItem, currentDimensionY);

            // Re-calculate domainY based on current range (or just use yScale domain)
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
        // Expose scales helpers if needed? 
        // Ideally logic stays internal.
        getScales: () => { // Helper for external calculations if absolutely needed
            const t = d3.zoomTransform(svg.node());
            return { xScale: t.rescaleX(xScale), yScale: t.rescaleY(yScale), width, height };
        },
        ruler
    };
}
