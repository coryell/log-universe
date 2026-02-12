import * as d3 from 'd3';
import { getUnit, parseValue } from './utils.js';

export function createRuler(svg) {
    let markedYData = null;
    let markedXData = null;
    let lastMousePos = null;

    // Mark Ruler (the persistent mark)
    const markGroup = svg.append("g")
        .attr("class", "mark-ruler")
        .style("pointer-events", "none")
        .style("display", "none");

    const markLineY = markGroup.append("line") // Horizontal line at fixed Y
        .attr("stroke", "red").attr("stroke-width", 1).attr("stroke-dasharray", "4,2");

    const markLineX = markGroup.append("line") // Vertical line at fixed X
        .attr("stroke", "red").attr("stroke-width", 1).attr("stroke-dasharray", "4,2");

    // Cursor Ruler
    const rulerGroup = svg.append("g")
        .attr("class", "cursor-ruler")
        .style("pointer-events", "none")
        .style("display", "none");

    // Vertical line (tracks X position)
    const rulerLineX = rulerGroup.append("line")
        .attr("stroke", "red").attr("stroke-width", 1).attr("stroke-dasharray", "4,2");

    const rulerLineY = rulerGroup.append("line") // This will be the vertical line tracking X
        .attr("stroke", "red").attr("stroke-width", 1).attr("stroke-dasharray", "4,2");

    // Interval connecting lines
    const intervalLineY = rulerGroup.append("line") // Vertical segment
        .attr("class", "interval-line-y")
        .attr("stroke", "red").attr("stroke-width", 1);

    const intervalLineX = rulerGroup.append("line") // Horizontal segment
        .attr("class", "interval-line-x")
        .attr("stroke", "red").attr("stroke-width", 1);

    const rulerLabelBackground = rulerGroup.append("rect")
        .attr("fill", "black").attr("rx", 4).attr("ry", 4).attr("opacity", 0.7);

    const rulerLabel = rulerGroup.append("text")
        .attr("fill", "white").style("font-family", "monospace").style("font-size", "12px").attr("dy", "0.35em").attr("text-anchor", "start");

    // Y-Interval Label
    const yIntervalBackground = rulerGroup.append("rect")
        .attr("fill", "black").attr("rx", 4).attr("ry", 4).attr("opacity", 0.7);

    const yIntervalLabel = rulerGroup.append("text")
        .attr("fill", "red").style("font-family", "monospace").style("font-size", "12px").attr("dy", "0.35em").attr("text-anchor", "start");

    // X-Interval Label
    const xIntervalBackground = rulerGroup.append("rect")
        .attr("fill", "black").attr("rx", 4).attr("ry", 4).attr("opacity", 0.7);

    const xIntervalLabel = rulerGroup.append("text")
        .attr("fill", "red").style("font-family", "monospace").style("font-size", "12px").attr("dy", "0.35em").attr("text-anchor", "start");

    function setMark(dataX, dataY, currentDimensionX) {
        markedYData = dataY;
        if (currentDimensionX !== "none") {
            markedXData = dataX;
        } else {
            markedXData = null;
        }
    }

    function clearMark() {
        markedYData = null;
        markedXData = null;
        markGroup.style("display", "none");
        yIntervalLabel.style("display", "none");
        yIntervalBackground.style("display", "none");
        intervalLineY.style("display", "none");
        xIntervalLabel.style("display", "none");
        xIntervalBackground.style("display", "none");
        intervalLineX.style("display", "none");
    }

    function update(config) {
        const {
            width, height,
            currentDimensionX, currentDimensionY,
            xScale, yScale,
            event
        } = config;

        // We rely on main loop to pass event or just update if we have lastMousePos
        if (event) {
            // Handle touch events explicitly if d3.pointer fails or returns NaN
            try {
                const p = d3.pointer(event, svg.node());
                if (isFinite(p[0]) && isFinite(p[1])) {
                    lastMousePos = p;
                }
            } catch (e) {
                // Ignore pointer errors
            }
        }

        if (!lastMousePos) return;

        rulerGroup.style("display", null);

        // Always fetch transform from SVG node as it's the source of truth
        const t = d3.zoomTransform(svg.node());
        const [mouseX, mouseY] = lastMousePos;
        if (!isFinite(mouseX) || !isFinite(mouseY)) return;

        // Update Lines lengths based on current width/height
        markLineY.attr("x2", width);
        markLineX.attr("y2", height);
        rulerLineX.attr("x2", width);
        rulerLineY.attr("y2", height);

        // Update Ruler Cursor Lines
        rulerLineX.attr("x1", 0).attr("y1", mouseY).attr("y2", mouseY); // Horizontal

        if (currentDimensionX !== "none") {
            rulerLineY.style("display", null);
            rulerLineY.attr("x1", mouseX).attr("x2", mouseX).attr("y1", 0); // Vertical
        } else {
            rulerLineY.style("display", "none");
        }

        const newYScale = t.rescaleY(yScale);
        const valY = newYScale.invert(mouseY);

        // Format Y
        const formatVal = (v, unit) => {
            const exp = v.toExponential(2);
            const [mantissa, exponent] = exp.split('e');
            const expVal = parseInt(exponent, 10);
            return `${mantissa} × 10^${expVal} ${unit}`;
        };

        let labelText = "";
        if (currentDimensionX !== "none") {
            const newXScale = t.rescaleX(xScale);
            const valX = newXScale.invert(mouseX);
            const txtY = formatVal(valY, getUnit(currentDimensionY));
            const txtX = formatVal(valX, getUnit(currentDimensionX));
            labelText = `Y: ${txtY}, X: ${txtX}`;
        } else {
            labelText = formatVal(valY, getUnit(currentDimensionY));
        }
        let labelY = mouseY - 15;
        // Move label below ruler if we are below a mark to avoid overlap with interval labels
        if (markedYData !== null && mouseY > newYScale(markedYData) + 2) {
            labelY = mouseY + 15;
        }

        rulerLabel.attr("x", mouseX + 15).attr("y", labelY).text(labelText);

        const lbox = rulerLabel.node().getBBox();
        rulerLabelBackground.attr("x", lbox.x - 4).attr("y", lbox.y - 4).attr("width", lbox.width + 8).attr("height", lbox.height + 8);

        // Common formatters
        const formatAbsolute = (v, dim) => {
            const sign = v > 0 ? "+" : "";
            if (v === 0) return `0 ${getUnit(dim)}`;
            const exp = v.toExponential(1);
            const [mantissa, exponent] = exp.split('e');
            return `${sign}${mantissa} × 10^${parseInt(exponent, 10)} ${getUnit(dim)}`;
        };

        const formatRelative = (v) => {
            const log = Math.log10(v);
            const exp = Math.floor(log);
            const coeff = v / Math.pow(10, exp);
            if (Math.abs(coeff - 1) < 0.001) return `10^${exp}`;
            if (Math.abs(coeff - 10) < 0.001) return `10^${exp + 1}`;
            return `${coeff.toFixed(1)} × 10^${exp}`;
        };

        const updateIntervalUI = (label, bg, line, val, markVal, mousePos, markPos, isHorizontal, dim, orthoPos, orthoMarkPos) => {
            if (markVal === null || Math.abs(mousePos - markPos) < 2) {
                label.style("display", "none");
                bg.style("display", "none");
                line.style("display", "none");
                return;
            }

            label.style("display", null);
            bg.style("display", null);
            line.style("display", null);

            // 1. Initial positioning and styling
            let baseLabelX = 0;
            let isFlipped = false;

            if (isHorizontal) {
                const drawY = (orthoMarkPos !== null) ? orthoMarkPos : orthoPos;
                line.attr("x1", markPos).attr("x2", mousePos).attr("y1", drawY).attr("y2", drawY);

                isFlipped = (orthoMarkPos !== null && orthoPos > orthoMarkPos);
                const labelY = isFlipped ? drawY - 20 : drawY + 20;

                label.attr("y", labelY).attr("text-anchor", "start");
                baseLabelX = (mousePos + markPos) / 2;
            } else {
                const drawX = (orthoMarkPos !== null) ? orthoMarkPos : orthoPos;
                line.attr("x1", drawX).attr("x2", drawX).attr("y1", markPos).attr("y2", mousePos);

                isFlipped = (orthoMarkPos !== null && orthoPos > orthoMarkPos);
                const labelX = isFlipped ? drawX - 15 : drawX + 15;
                const anchor = isFlipped ? "end" : "start";

                label.attr("x", labelX).attr("y", (mousePos + markPos) / 2).attr("text-anchor", anchor);
                baseLabelX = labelX;
            }

            // 2. Build text content
            const relText = `x${formatRelative(val / markVal)}`;
            const absText = formatAbsolute(val - markVal, dim);

            const tspans = label.selectAll("tspan")
                .data([relText, absText])
                .join("tspan")
                .attr("dy", (d, i) => i === 0 ? 0 : "1.2em")
                .text(d => d);

            // 3. Final alignment and coordinate adjustments
            if (isHorizontal) {
                const bbox = label.node().getBBox();
                const shiftedX = baseLabelX - bbox.width / 2;
                label.attr("x", shiftedX);
                tspans.attr("x", shiftedX);

                // If flipped (above), adjust Y to account for whole height
                if (isFlipped) {
                    label.attr("y", parseFloat(label.attr("y")) - bbox.height + 15);
                }
            } else {
                tspans.attr("x", baseLabelX);
            }

            // 4. Update background
            const box = label.node().getBBox();
            bg.attr("x", box.x - 4).attr("y", box.y - 4).attr("width", box.width + 8).attr("height", box.height + 8);
        };

        // Update Marks
        if (markedYData !== null || markedXData !== null) {
            markGroup.style("display", null);
            let my = null;
            if (markedYData !== null) {
                my = newYScale(markedYData);
                markLineY.style("display", null).attr("y1", my).attr("y2", my).attr("x2", width);
            } else {
                markLineY.style("display", "none");
            }

            let mx = null;
            if (markedXData !== null && currentDimensionX !== "none") {
                mx = t.rescaleX(xScale)(markedXData);
                markLineX.style("display", null).attr("x1", mx).attr("x2", mx).attr("y2", height);
            } else {
                markLineX.style("display", "none");
            }

            // Update Interval UI
            if (markedYData !== null) {
                updateIntervalUI(yIntervalLabel, yIntervalBackground, intervalLineY, valY, markedYData, mouseY, my, false, currentDimensionY, mouseX, mx);
            } else {
                yIntervalLabel.style("display", "none");
                yIntervalBackground.style("display", "none");
                intervalLineY.style("display", "none");
            }

            if (markedXData !== null && currentDimensionX !== "none") {
                updateIntervalUI(xIntervalLabel, xIntervalBackground, intervalLineX, t.rescaleX(xScale).invert(mouseX), markedXData, mouseX, mx, true, currentDimensionX, mouseY, my);
            } else {
                xIntervalLabel.style("display", "none");
                xIntervalBackground.style("display", "none");
                intervalLineX.style("display", "none");
            }
        } else {
            markGroup.style("display", "none");
            yIntervalLabel.style("display", "none");
            yIntervalBackground.style("display", "none");
            intervalLineY.style("display", "none");
            xIntervalLabel.style("display", "none");
            xIntervalBackground.style("display", "none");
            intervalLineX.style("display", "none");
        }
    }

    function hide() {
        rulerGroup.style("display", "none");
    }

    return {
        update,
        setMark,
        clearMark,
        hide
    };
}
