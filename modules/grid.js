import * as d3 from 'd3';
import { getUnit } from './utils.js';

/**
 * Creates a grid renderer that draws tick marks, grid lines, and axis labels.
 */
export function createGrid(gridGroup, xLabelGroup, yLabelGroup, mobileMask) {

    /**
     * Renders the grid based on the current zoom transform.
     * @param {d3.ZoomTransform} transform - Current zoom transform
     * @param {Object} state - { width, height, xScale, yScale, currentDimensionX, currentDimensionY, isMobile }
     */
    function updateGrid(transform, state) {
        const { width, height, xScale, yScale, currentDimensionX, currentDimensionY, isMobile } = state;
        const newYScale = transform.rescaleY(yScale);
        const newXScale = transform.rescaleX(xScale);
        const padding = 200;

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
            if (isFinite(logMin) && isFinite(logMax) && logMax - logMin < 200) {
                const allYDecades = [];
                for (let i = logMin; i <= logMax; i++) allYDecades.push(Math.pow(10, i));
                yTickValues = Array.from(new Set([...yTickValues, ...allYDecades])).sort((a, b) => a - b);
            }
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

        // 1D Mode Logic
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

            // Y Labels (1D: Inside horizontal-grid tick text)
            gridGroup.selectAll(".horizontal-grid .tick text")
                .attr("x", 10).attr("dy", -4).attr("fill", "#00aaff")
                .style("font-family", "monospace").style("font-size", "12px")
                .attr("opacity", d => majorYDecades.has(d) ? 1.0 : 0);

            // Clear 2D labels
            xLabelGroup.selectAll(".x-label").remove();
            yLabelGroup.selectAll(".y-label").remove();

        } else {
            // 2D Mode Logic
            const xStart = newXScale.invert(-padding);
            const xEnd = newXScale.invert(width + padding);
            const paddedXScale = newXScale.copy().domain([d3.min([xStart, xEnd]), d3.max([xStart, xEnd])]);
            let xTickValues = paddedXScale.ticks(isMobile ? 8 : 15, "~e");
            const hasSubTenX = xTickValues.some(d => !Number.isInteger(Math.log10(d)));
            const majorXDecades = new Set();
            xTickValues.forEach(d => { if (Number.isInteger(Math.log10(d))) majorXDecades.add(d); });

            if (!hasSubTenX) {
                const logMin = Math.ceil(Math.log10(d3.min([xStart, xEnd])));
                const logMax = Math.floor(Math.log10(d3.max([xStart, xEnd])));
                if (isFinite(logMin) && isFinite(logMax) && logMax - logMin < 200) {
                    const allXDecades = [];
                    for (let i = logMin; i <= logMax; i++) allXDecades.push(Math.pow(10, i));
                    xTickValues = Array.from(new Set([...xTickValues, ...allXDecades])).sort((a, b) => a - b);
                }
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

            // Hide default axis text
            gridGroup.selectAll(".vertical-grid .tick text").attr("opacity", 0);
            gridGroup.selectAll(".horizontal-grid .tick text").attr("opacity", 0);

            // X Labels (Custom D3 Join)
            let xTicksForLabels = xTickValues.filter(d => majorXDecades.has(d));

            // Mobile: Filter labels to prevent squashing (min 80px gap)
            if (isMobile && xTicksForLabels.length > 1) {
                const minGap = 80;
                const filtered = [];
                let lastPos = -Infinity;
                xTicksForLabels.forEach(d => {
                    const pos = newXScale(d);
                    if (Math.abs(pos - lastPos) >= minGap) {
                        filtered.push(d);
                        lastPos = pos;
                    }
                });
                xTicksForLabels = filtered;
            }

            xLabelGroup.selectAll(".x-label")
                .data(xTicksForLabels, d => d)
                .join(
                    enter => enter.append("text")
                        .attr("class", "x-label")
                        .attr("text-anchor", "middle")
                        .attr("fill", "#00aaff")
                        .style("font-family", "monospace")
                        .style("font-size", "12px")
                        .text(d => `10^${Math.log10(d)} ${getUnit(currentDimensionX)}`),
                    update => update,
                    exit => exit.remove()
                )
                .attr("x", d => newXScale(d))
                .attr("y", isMobile ? height - 60 : height - 20);

            // Y Labels (Custom D3 Join)
            const yTicksForLabels = yTickValues.filter(d => majorYDecades.has(d));
            yLabelGroup.selectAll(".y-label")
                .data(yTicksForLabels, d => d)
                .join(
                    enter => enter.append("text")
                        .attr("class", "y-label")
                        .attr("x", 10)
                        .attr("fill", "#00aaff")
                        .style("font-family", "monospace")
                        .style("font-size", "12px")
                        .text(d => `10^${Math.log10(d)} ${getUnit(currentDimensionY)}`),
                    update => update,
                    exit => exit.remove()
                )
                .attr("y", d => newYScale(d) - 4);
        }

        gridGroup.select(".vertical-grid .domain").remove();
        gridGroup.selectAll(".horizontal-grid .tick line")
            .attr("stroke", "#00aaff").attr("stroke-dasharray", "2,2")
            .attr("stroke-opacity", d => (majorYDecades.has(d)) ? 0.4 : 0.25);

        // Mobile Mask Logic (Extreme: No getBBox)
        if (mobileMask && isMobile) {
            const bgPad = 2;
            const charRatio = 0.6;
            const fs = 12;
            const charWidth = fs * charRatio;
            let labelRects = [];

            if (currentDimensionX === "none") {
                // 1D: Labels inside horizontal-grid ticks
                gridGroup.selectAll(".horizontal-grid .tick")
                    .filter(d => majorYDecades.has(d))
                    .each(function (d) {
                        const text = `10^${Math.log10(d)} ${getUnit(currentDimensionY)}`;
                        const textW = text.length * charWidth;
                        const transform = d3.select(this).attr("transform");
                        const match = transform && transform.match(/translate\(\s*([^,)]+)[,\s]+([^)]+)\)/);
                        const ty = match ? parseFloat(match[2]) : 0;

                        // Center background on text (baseline is ty - 4)
                        labelRects.push({
                            id: `y-${d}`,
                            x: 10 - bgPad,
                            y: ty - 4 - (fs * 1.0) - bgPad,
                            width: textW + bgPad * 2,
                            height: fs * 1.2 + bgPad * 2
                        });
                    });
            } else {
                // 2D: Labels in custom groups
                xLabelGroup.selectAll(".x-label").each(function (d) {
                    const text = `10^${Math.log10(d)} ${getUnit(currentDimensionX)}`;
                    const textW = text.length * charWidth;
                    const x = parseFloat(d3.select(this).attr("x"));
                    const y = parseFloat(d3.select(this).attr("y"));
                    labelRects.push({
                        id: `x-${d}`,
                        x: x - (textW / 2) - bgPad,
                        y: y - (fs * 0.9) - bgPad,
                        width: textW + bgPad * 2,
                        height: fs * 1.2 + bgPad * 2
                    });
                });
                yLabelGroup.selectAll(".y-label").each(function (d) {
                    const text = `10^${Math.log10(d)} ${getUnit(currentDimensionY)}`;
                    const textW = text.length * charWidth;
                    const y = parseFloat(d3.select(this).attr("y"));
                    labelRects.push({
                        id: `y-${d}`,
                        x: 10 - bgPad,
                        y: y - (fs * 0.9) - bgPad,
                        width: textW + bgPad * 2,
                        height: fs * 1.2 + bgPad * 2
                    });
                });
            }

            // JOIN mask rects
            mobileMask.selectAll(".label-cutout")
                .data(labelRects, d => d.id)
                .join(
                    enter => enter.append("rect")
                        .attr("class", "label-cutout")
                        .attr("fill", "black"),
                    update => update,
                    exit => exit.remove()
                )
                .attr("x", d => d.x)
                .attr("y", d => d.y)
                .attr("width", d => d.width)
                .attr("height", d => d.height);

        } else if (mobileMask) {
            mobileMask.selectAll(".label-cutout").remove();
        }
    }

    return { updateGrid };
}
