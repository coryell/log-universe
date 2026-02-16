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

        // X and Y Tick Values (Padded)
        const yStart = newYScale.invert(height + padding);
        const yEnd = newYScale.invert(-padding);
        const paddedYScale = newYScale.copy().domain([d3.min([yStart, yEnd]), d3.max([yStart, yEnd])]);
        let yTickValues = paddedYScale.ticks(15, "~e");

        const xStart = newXScale.invert(-padding);
        const xEnd = newXScale.invert(width + padding);
        const paddedXScale = newXScale.copy().domain([d3.min([xStart, xEnd]), d3.max([xStart, xEnd])]);
        let xTickValues = paddedXScale.ticks(isMobile ? 8 : 15, "~e");




        // Determine minor label visibility early
        // Threshold: Show minor/sub-decade labels if <= 1 major decade LABELS are on screen.
        const allVisibleXTicks = xTickValues.filter(d => {
            const pos = newXScale(d);
            return pos >= 0 && pos <= width;
        });

        const decadesXOnScreen = allVisibleXTicks.filter(d => Number.isInteger(parseFloat(Math.log10(d).toFixed(10))));
        let majorXLabelsOnScreen = decadesXOnScreen;

        // Account for mobile gap filtering in the threshold
        if (isMobile && decadesXOnScreen.length > 1) {
            const minGap = 80;
            const filtered = [];
            let lastPos = -Infinity;
            decadesXOnScreen.forEach(d => {
                const pos = newXScale(d);
                const isDecade = Number.isInteger(parseFloat(Math.log10(d).toFixed(10)));
                // ALWAYS keep decades; only filter others if too close
                if (isDecade || Math.abs(pos - lastPos) >= minGap) {
                    filtered.push(d);
                    lastPos = pos;
                }
            });
            majorXLabelsOnScreen = filtered;
        }

        const showMinorXLabels = majorXLabelsOnScreen.length <= 1;

        const majorYLabelsOnScreen = yTickValues.filter(d => {
            if (!Number.isInteger(parseFloat(Math.log10(d).toFixed(10)))) return false;
            const pos = newYScale(d);
            return pos >= 0 && pos <= height;
        });
        // Y labels don't currently have a gap filter, so labels == visible lines
        const showMinorYLabels = majorYLabelsOnScreen.length <= 1;


        // Label Formatter Helpers
        const formatYTick = (d, showMinor) => {
            const log10 = Math.log10(d);
            const isMajor = Number.isInteger(parseFloat(log10.toFixed(10)));
            if (isMajor) return `10^${Math.round(log10)} ${getUnit(currentDimensionY)}`;
            if (showMinor) {
                const exp = Math.floor(log10);
                const rawCoeff = d / Math.pow(10, exp);
                // Use toFixed(2) but strip trailing zeros; + converts back to number for clean string
                const coeff = +rawCoeff.toFixed(3);
                return `${coeff} × 10^${exp} ${getUnit(currentDimensionY)}`;
            }
            return "";
        };

        const formatXTick = (d, showMinor, isFirst) => {
            const log10 = Math.log10(d);
            const isMajor = Number.isInteger(parseFloat(log10.toFixed(10)));
            if (isMajor) return `10^${Math.round(log10)} ${getUnit(currentDimensionX)}`;

            if (!showMinor) return "";

            // User's specific relative logic for sub-decades
            if (majorXLabelsOnScreen.length === 1) {
                const V = majorXLabelsOnScreen[0];
                const ratio = d / V;
                // Preserve precision for the multiplier
                const label = +ratio.toFixed(3);
                return `${label} ×`;
            } else if (majorXLabelsOnScreen.length === 0) {
                const exp = Math.floor(log10);
                const rawCoeff = d / Math.pow(10, exp);
                const coeff = +rawCoeff.toFixed(3);

                if (isFirst) {
                    return `${coeff} × 10^${exp} ${getUnit(currentDimensionX)}`;
                } else {
                    return `${coeff} ×`;
                }
            }
            return "";
        };


        // Y Axis Grid
        const majorYDecades = new Set();
        yTickValues.forEach(d => { if (Number.isInteger(parseFloat(Math.log10(d).toFixed(10)))) majorYDecades.add(d); });


        gridGroup.selectAll(".horizontal-grid").data([null]).join("g")
            .attr("class", "horizontal-grid")
            .call(d3.axisRight(newYScale)
                .tickValues(yTickValues)
                .tickSize(width)
                .tickFormat(d => formatYTick(d, showMinorYLabels))
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
                .attr("opacity", d => (majorYDecades.has(d) || showMinorYLabels) ? 1.0 : 0);

            // Clear 2D labels
            xLabelGroup.selectAll(".x-label").remove();
            yLabelGroup.selectAll(".y-label").remove();

        } else {
            // 2D Mode Logic
            const majorXDecades = new Set();
            xTickValues.forEach(d => { if (Number.isInteger(parseFloat(Math.log10(d).toFixed(10)))) majorXDecades.add(d); });


            gridGroup.select(".vertical-grid")
                .call(d3.axisBottom(newXScale)
                    .tickValues(xTickValues)
                    .tickSize(height)
                    .tickFormat(d => formatXTick(d, showMinorXLabels, d === allVisibleXTicks[0]))
                );


            gridGroup.selectAll(".vertical-grid .tick line")
                .attr("stroke", "#00aaff").attr("stroke-dasharray", "2,2")
                .attr("stroke-opacity", d => (majorXDecades.has(d)) ? 0.4 : 0.25);

            // Hide default axis text
            gridGroup.selectAll(".vertical-grid .tick text").attr("opacity", 0);
            gridGroup.selectAll(".horizontal-grid .tick text").attr("opacity", 0);

            // X Labels (Custom D3 Join)
            // Use allVisibleXTicks strictly to sync with threshold logic
            let xTicksForLabels = allVisibleXTicks.filter(d => majorXDecades.has(d) || showMinorXLabels);


            // Mobile: Filter labels to prevent squashing (min 80px gap)
            if (isMobile && xTicksForLabels.length > 1) {
                const minGap = 80;
                const filtered = [];
                let lastPos = -Infinity;

                // Pre-calculate major decade positions to use as "anchors"
                const decadePositions = xTicksForLabels
                    .filter(d => majorXDecades.has(d))
                    .map(d => newXScale(d));

                xTicksForLabels.forEach(d => {
                    const pos = newXScale(d);
                    const isDecade = majorXDecades.has(d);

                    if (isDecade) {
                        // ALWAYS keep decades
                        filtered.push(d);
                        lastPos = pos;
                    } else {
                        // For sub-decades: must be far from PREVIOUS label AND NEXT decade anchor
                        const distToPrev = Math.abs(pos - lastPos);
                        const nextDecadePos = decadePositions.find(p => p > pos);
                        const distToNextDecade = nextDecadePos !== undefined ? Math.abs(nextDecadePos - pos) : Infinity;

                        if (distToPrev >= minGap && distToNextDecade >= minGap) {
                            filtered.push(d);
                            lastPos = pos;
                        }
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
                        .style("font-size", "12px"),
                    update => update,
                    exit => exit.remove()
                )
                .each(function (d, i) {
                    const text = formatXTick(d, showMinorXLabels, i === 0);
                    const el = d3.select(this);
                    el.text(text);

                    const charWidth = 12 * 0.6; // 12px monospace approx
                    const textWidth = text.length * charWidth;
                    const halfWidth = textWidth / 2;

                    const x = newXScale(d);
                    // Constrain to screen edges with small padding
                    const safeX = Math.max(halfWidth + 4, Math.min(width - halfWidth - 4, x));
                    el.attr("x", safeX);
                })

                .attr("y", height - 20);

            // Y Labels (Custom D3 Join)
            // Use majorYLabelsOnScreen for decades, and filter minor ticks strictly by height
            const yTicksForLabels = yTickValues.filter(d => {
                const pos = newYScale(d);
                const isOnScreen = pos >= 0 && pos <= height;
                return isOnScreen && (majorYDecades.has(d) || showMinorYLabels);
            });

            yLabelGroup.selectAll(".y-label")
                .data(yTicksForLabels, d => d)
                .join(
                    enter => enter.append("text")
                        .attr("class", "y-label")
                        .attr("x", 10)
                        .attr("fill", "#00aaff")
                        .style("font-family", "monospace")
                        .style("font-size", "12px"),
                    update => update,
                    exit => exit.remove()
                )
                .text(d => formatYTick(d, showMinorYLabels))
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
                    .filter(d => majorYDecades.has(d) || showMinorYLabels)
                    .each(function (d) {
                        const text = formatYTick(d, showMinorYLabels);
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
                xLabelGroup.selectAll(".x-label").each(function (d, i) {
                    const text = formatXTick(d, showMinorXLabels, i === 0);

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
                    const text = formatYTick(d, showMinorYLabels);
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
