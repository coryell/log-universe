import * as d3 from 'd3';
import { getUnit } from './utils.js';

/**
 * Creates a grid renderer that draws tick marks, grid lines, and axis labels.
 */
export function createGrid(gridGroup, xLabelGroup, yLabelGroup) {

    /**
     * Renders the grid based on the current zoom transform.
     * @param {d3.ZoomTransform} transform - Current zoom transform
     * @param {Object} state - { width, height, xScale, yScale, currentDimensionX, currentDimensionY }
     */
    function updateGrid(transform, state) {
        const { width, height, xScale, yScale, currentDimensionX, currentDimensionY } = state;
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
    }

    return { updateGrid };
}
