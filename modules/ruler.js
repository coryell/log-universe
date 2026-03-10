// Copyright (c) 2026 Cutter Coryell
// SPDX-License-Identifier: MIT

import * as d3 from 'd3';
import { getUnit, parseValue, formatRelative, formatAbsolute } from './utils.js';

export function createRuler(svg, checkTouch) {
    let markedYData = null;
    let markedXData = null;
    let lastMousePos = null;
    let lastMouseDataX = null;
    let lastMouseDataY = null;
    let lastConfig = null;
    let _isDragging = false;
    let _isMarkDragging = false;
    let _markDragOffset = [0, 0];
    let _markStartData = { x: null, y: null };
    let _startCursorPos = null; // Track cursor pos at drag start for 1D delta
    let _didMarkMove = false; // Track if mark was dragged or just tapped
    let _rulerLongPressOccurred = false; // Track if a mark was set via long-press during this touch

    // Cursor Ruler (Create FIRST so it is below the Mark)
    const rulerGroup = svg.append("g")
        .attr("class", "cursor-ruler")
        .style("pointer-events", "none")
        .style("display", "none");

    // Mark Ruler (the persistent mark - Create SECOND so it is ON TOP)
    const markGroup = svg.append("g")
        .attr("class", "mark-ruler")
        .style("pointer-events", "none")
        .style("display", "none");

    // Mark Lines (Append to markGroup)
    const markLineY = markGroup.append("line") // Horizontal line at fixed Y
        .attr("stroke", "green").attr("stroke-width", 1).attr("stroke-dasharray", "4,2");

    const markLineX = markGroup.append("line") // Vertical line at fixed X
        .attr("stroke", "green").attr("stroke-width", 1).attr("stroke-dasharray", "4,2");

    // Invisible hit lines for dragging the mark (Mobile only)
    const markHitLineY = markGroup.append("line")
        .attr("stroke", "transparent").attr("stroke-width", 30)
        .style("cursor", "move")
        .style("pointer-events", "stroke");

    const markHitLineX = markGroup.append("line")
        .attr("stroke", "transparent").attr("stroke-width", 30)
        .style("cursor", "move")
        .style("pointer-events", "stroke");

    // Interval connecting lines (Moved to markGroup for dragging)
    const intervalLineY = markGroup.append("line") // Vertical segment
        .attr("class", "interval-line-y")
        .attr("stroke", "green").attr("stroke-width", 2);

    const intervalHitLineY = markGroup.append("line")
        .attr("stroke", "transparent").attr("stroke-width", 30)
        .style("cursor", "move")
        .style("pointer-events", "stroke");

    const intervalLineX = markGroup.append("line") // Horizontal segment
        .attr("class", "interval-line-x")
        .attr("stroke", "green").attr("stroke-width", 2);

    const intervalHitLineX = markGroup.append("line")
        .attr("stroke", "transparent").attr("stroke-width", 30)
        .style("cursor", "move")
        .style("pointer-events", "stroke");

    // Y-Interval Label (Moved to markGroup)
    const yIntervalBackground = markGroup.append("rect")
        .attr("fill", "black").attr("rx", 4).attr("ry", 4).attr("opacity", 0.7)
        .style("pointer-events", "all");

    const yIntervalLabel = markGroup.append("text")
        .attr("fill", "green").style("font-family", "monospace").style("font-size", "12px").attr("dy", "0.35em").attr("text-anchor", "start")
        .style("pointer-events", "none"); // Let background capture events

    // X-Interval Label (Moved to markGroup)
    const xIntervalBackground = markGroup.append("rect")
        .attr("fill", "black").attr("rx", 4).attr("ry", 4).attr("opacity", 0.7)
        .style("pointer-events", "all");

    const xIntervalLabel = markGroup.append("text")
        .attr("fill", "green").style("font-family", "monospace").style("font-size", "12px").attr("dy", "0.35em").attr("text-anchor", "start")
        .style("pointer-events", "none");

    // Label background and text (drawn FIRST so lines render on top)
    const rulerLabelBackground = rulerGroup.append("rect")
        .attr("fill", "black").attr("rx", 4).attr("ry", 4).attr("opacity", 0.7);

    const rulerLabelHitRect = rulerGroup.append("rect")
        .attr("fill", "transparent").style("pointer-events", "all");

    const rulerLabel = rulerGroup.append("text")
        .attr("fill", "red").style("font-family", "monospace").style("font-size", "12px").attr("dy", "0.35em").attr("text-anchor", "start");

    const rulerLabelLine1 = rulerLabel.append("tspan");
    const rulerLabelLine2 = rulerLabel.append("tspan");

    // Ruler lines (drawn AFTER label so they render on top of the background)
    const rulerLineX = rulerGroup.append("line")
        .attr("stroke", "red").attr("stroke-width", 1).attr("stroke-dasharray", "4,2");

    const rulerLineY = rulerGroup.append("line") // This will be the vertical line tracking X
        .attr("stroke", "red").attr("stroke-width", 1).attr("stroke-dasharray", "4,2");

    // Invisible hit lines for mobile touch targets (Red Ruler)
    const rulerHitLineX = rulerGroup.append("line")
        .attr("stroke", "transparent").attr("stroke-width", 30)
        .style("pointer-events", "stroke");

    const rulerHitLineY = rulerGroup.append("line")
        .attr("stroke", "transparent").attr("stroke-width", 30)
        .style("pointer-events", "stroke");

    // Touch drag handlers for mobile
    let _dragOffset = [0, 0];
    let _touchStartedOnLabel = false;
    let _didMove = false;
    let _rulerLongPressTimer = null;

    rulerGroup.node().addEventListener('touchstart', (e) => {
        if (!checkTouch || !checkTouch()) return;
        e.stopPropagation();
        e.preventDefault();
        _isDragging = true;
        _didMove = false;
        _rulerLongPressOccurred = false;
        // Check if touch started on the label or its background
        const target = e.target;
        const labelNode = rulerLabel.node();
        const bgNode = rulerLabelBackground.node();
        const hitNode = rulerLabelHitRect.node();
        _touchStartedOnLabel = (target === labelNode || target === bgNode || target === hitNode || labelNode.contains(target));
        // Record offset between touch position and current ruler position
        const p = d3.pointer(e.touches[0], svg.node());
        if (lastMousePos && isFinite(p[0]) && isFinite(p[1])) {
            _dragOffset = [p[0] - lastMousePos[0], p[1] - lastMousePos[1]];
        } else {
            _dragOffset = [0, 0];
        }
        // Capture position at start of touch for stable marking
        const startMousePos = lastMousePos ? [...lastMousePos] : null;

        // Long-press: set mark at current ruler position after 500ms
        _rulerLongPressTimer = setTimeout(() => {
            if (startMousePos && lastConfig) {
                const t = d3.zoomTransform(svg.node());
                // Use startMousePos instead of lastMousePos to avoid drift/jumps
                const yVal = lastConfig.yScale.invert(startMousePos[1]);
                let xVal = null;
                if (lastConfig.currentDimensionX !== "none") {
                    xVal = lastConfig.xScale.invert(startMousePos[0]);
                }
                setMark(xVal, yVal, lastConfig.currentDimensionX);
                _rulerLongPressOccurred = true;
                update(lastConfig);
                if (navigator.vibrate) navigator.vibrate(50);
            }
        }, 500);
    }, { passive: false });

    rulerGroup.node().addEventListener('touchmove', (e) => {
        if (!_isDragging || !lastConfig) return;
        e.stopPropagation();
        e.preventDefault();
        _didMove = true;
        if (_rulerLongPressTimer) { clearTimeout(_rulerLongPressTimer); _rulerLongPressTimer = null; }
        const touch = e.touches[0];
        const p = d3.pointer(touch, svg.node());
        if (isFinite(p[0]) && isFinite(p[1])) {
            lastMousePos = [p[0] - _dragOffset[0], p[1] - _dragOffset[1]];
        }
        update(lastConfig);
    }, { passive: false });

    rulerGroup.node().addEventListener('touchend', (e) => {
        _isDragging = false;
        if (checkTouch && checkTouch()) {
            e.stopPropagation();
            e.preventDefault();
        }
        if (_rulerLongPressTimer) { clearTimeout(_rulerLongPressTimer); _rulerLongPressTimer = null; }
        if (!_didMove && !_rulerLongPressOccurred) {
            hide();
            clearMark();
            lastMousePos = null;
        } else if (_touchStartedOnLabel && (!checkTouch || !checkTouch())) {
            // Click-through logic: if it was a tap (not a drag), verify what's underneath
            const touch = e.changedTouches[0];
            const clientX = touch.clientX;
            const clientY = touch.clientY;

            // 1. Hide ruler temporarily so elementFromPoint sees what's under it
            rulerGroup.style("display", "none");

            // 2. Find the element at that point
            const target = document.elementFromPoint(clientX, clientY);

            // 3. Dispatch a click event to it
            if (target) {
                const clickEvent = new MouseEvent("click", {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: clientX,
                    clientY: clientY
                });
                target.dispatchEvent(clickEvent);
            }

            // 4. Restore ruler (if it wasn't supposed to be hidden by the click)
            // Note: If the click triggered an action that moves the ruler (like selecting a point),
            // the visualization update loop will handle showing it again or moving it.
            // If we just restore it immediately, it might flicker or obscure the result.
            // However, we must restore it if nothing happened.
            // A safe bet is to restore it, relying on the fact that if the click
            // caused a selection, 'update' will be called soon.
            rulerGroup.style("display", null);
        }
    });
    // Mark Drag Handlers (Mobile Only)
    const handleMarkDragStart = (e) => {
        if (!checkTouch || !checkTouch()) return;
        e.stopPropagation();
        e.preventDefault();
        _isMarkDragging = true;
        _didMarkMove = false;
        const p = d3.pointer(e.touches[0], svg.node());
        _markDragOffset = [p[0], p[1]]; // Store initial touch pos
        _markStartData = { x: markedXData, y: markedYData };
        if (lastMousePos) {
            _startCursorPos = [...lastMousePos];
        } else {
            _startCursorPos = null;
        }
    };

    const handleMarkDragMove = (e) => {
        if (!_isMarkDragging || !lastConfig) return;
        _didMarkMove = true;
        e.stopPropagation(); // Prevent red ruler from moving
        e.preventDefault();

        const touch = e.touches[0];
        const p = d3.pointer(touch, svg.node());
        const dx = p[0] - _markDragOffset[0];
        const dy = p[1] - _markDragOffset[1];

        // 1D Specific Behavior: Horizontal drag moves the cursor (red ruler position) using DELTA
        if (lastConfig.currentDimensionX === "none" && lastMousePos && _startCursorPos) {
            lastMousePos[0] = _startCursorPos[0] + dx;
        }

        // Delta is in pixels. Convert start pixel + delta -> data
        // We need to re-calculate the PIXEL position of the start data first
        // effectively: currentPixel = scale(startData) + delta
        // newData = scale.invert(currentPixel)

        if (_markStartData.y !== null) {
            const startYPix = lastConfig.yScale(_markStartData.y);
            const newYPix = startYPix + dy;
            const newYData = lastConfig.yScale.invert(newYPix);
            markedYData = newYData;
        }

        if (_markStartData.x !== null && lastConfig.currentDimensionX !== "none") {
            const startXPix = lastConfig.xScale(_markStartData.x);
            const newXPix = startXPix + dx;
            const newXData = lastConfig.xScale.invert(newXPix);
            markedXData = newXData;
        }

        update(lastConfig);
    };

    const handleMarkDragEnd = (e) => {
        if (_isMarkDragging) {
            e.stopPropagation();
            e.preventDefault();
            if (!_didMarkMove) {
                hide();
                clearMark();
                lastMousePos = null;
            }
        }
        _isMarkDragging = false;
    };

    markGroup.node().addEventListener('touchstart', handleMarkDragStart, { passive: false });
    markGroup.node().addEventListener('touchmove', handleMarkDragMove, { passive: false });
    markGroup.node().addEventListener('touchend', handleMarkDragEnd, { passive: false });
    markGroup.node().addEventListener('touchcancel', handleMarkDragEnd, { passive: false });

    markGroup.node().addEventListener('click', (e) => {
        if (checkTouch && checkTouch()) {
            e.stopPropagation();
            e.preventDefault();
            hide();
            clearMark();
            lastMousePos = null;
        }
    });

    // Fix for ruler intercepting clicks when it moves under the cursor/finger
    rulerGroup.node().addEventListener('click', (e) => {
        // Stop bubbling to prevent window click listener from deselecting
        e.stopPropagation();
        e.preventDefault();

        if (checkTouch && checkTouch()) {
            hide();
            clearMark();
            lastMousePos = null;
            return;
        }

        const clientX = e.clientX;
        const clientY = e.clientY;

        // 1. Hide ruler temporarily
        rulerGroup.style("display", "none");

        // 2. Click-through logic
        const target = document.elementFromPoint(clientX, clientY);

        if (target) {
            const clickEvent = new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: clientX,
                clientY: clientY
            });
            target.dispatchEvent(clickEvent);
        }

        // 3. Restore ruler
        rulerGroup.style("display", null);
    });

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
        intervalHitLineY.style("display", "none");
        xIntervalLabel.style("display", "none");
        xIntervalBackground.style("display", "none");
        intervalLineX.style("display", "none");
        intervalHitLineX.style("display", "none");
    }

    function update(config) {
        const {
            width, height,
            currentDimensionX, currentDimensionY,
            xScale, yScale,
            event
        } = config;

        // Cache config (without event) for drag self-updates
        lastConfig = { ...config, event: undefined };

        // Toggle pointer-events based on mobile state
        const isMobile = checkTouch && checkTouch();
        rulerGroup.style("pointer-events", isMobile ? "all" : "none");

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
        } else if (lastMouseDataY !== null && !_isDragging && !_isMarkDragging) {
            // Re-calculate pixel position from data anchors (e.g. during resize/zoom)
            // BUT ONLY if not currently dragging (mobile), to avoid fighting the drag handler
            const py = yScale(lastMouseDataY);
            let px = lastMousePos ? lastMousePos[0] : 0;
            if (lastMouseDataX !== null && currentDimensionX !== "none") {
                px = xScale(lastMouseDataX);
            }
            lastMousePos = [px, py];
        }

        // Sync data anchors with current pixel position (if valid)
        // This ensures that after a drag or mousemove, we have the correct data for the next resize
        if (lastMousePos) {
            lastMouseDataY = yScale.invert(lastMousePos[1]);
            if (currentDimensionX !== "none") {
                lastMouseDataX = xScale.invert(lastMousePos[0]);
            }
        }

        // Update Lines lengths based on current width/height
        markLineY.attr("x2", width);
        markLineX.attr("y2", height);
        rulerLineX.attr("x2", width);
        rulerLineY.attr("y2", height);

        // Update Persistent Marks (even if lastMousePos is null)
        let my = null;
        let mx = null;
        if (markedYData !== null || markedXData !== null) {
            markGroup.style("display", null);
            if (markedYData !== null) {
                my = yScale(markedYData);
                markLineY.style("display", null).attr("y1", my).attr("y2", my).attr("x2", width);
                markHitLineY.style("display", null).attr("y1", my).attr("y2", my).attr("x2", width);
            } else {
                markLineY.style("display", "none");
                markHitLineY.style("display", "none");
            }

            if (markedXData !== null && currentDimensionX !== "none") {
                mx = xScale(markedXData);
                markLineX.style("display", null).attr("x1", mx).attr("x2", mx).attr("y2", height);
                markHitLineX.style("display", null).attr("x1", mx).attr("x2", mx).attr("y2", height);
            } else {
                markLineX.style("display", "none");
                markHitLineX.style("display", "none");
            }


        } else {
            markGroup.style("display", "none");
        }

        if (!lastMousePos) {
            rulerGroup.style("display", "none");
            yIntervalLabel.style("display", "none");
            yIntervalBackground.style("display", "none");
            intervalLineY.style("display", "none");
            intervalHitLineY.style("display", "none");
            xIntervalLabel.style("display", "none");
            xIntervalBackground.style("display", "none");
            intervalLineX.style("display", "none");
            intervalHitLineX.style("display", "none");
            return;
        }

        rulerGroup.style("display", null);
        const [mouseX, mouseY] = lastMousePos;
        if (!isFinite(mouseX) || !isFinite(mouseY)) return;

        // 2D Touch: draw label on top of lines; otherwise draw lines on top of label background
        if (isMobile && currentDimensionX !== "none") {
            rulerLabelBackground.raise();
            rulerLabel.raise();
        } else {
            rulerLineX.raise();
            rulerLineY.raise();
        }

        // Update Ruler Cursor Lines
        rulerLineX.attr("x1", 0).attr("y1", mouseY).attr("y2", mouseY); // Horizontal
        rulerHitLineX.attr("x1", 0).attr("x2", width).attr("y1", mouseY).attr("y2", mouseY);

        if (currentDimensionX !== "none") {
            rulerLineY.style("display", null);
            rulerLineY.attr("x1", mouseX).attr("x2", mouseX).attr("y1", 0); // Vertical
            rulerHitLineY.style("display", null);
            rulerHitLineY.attr("x1", mouseX).attr("x2", mouseX).attr("y1", 0).attr("y2", height);
        } else {
            rulerLineY.style("display", "none");
            rulerHitLineY.style("display", "none");
        }

        // const newYScale = t.rescaleY(yScale); // REMOVED
        const valY = yScale.invert(mouseY); // Use passed rescaled scale

        // Format Y
        const formatVal = (v, unit) => {
            const exp = v.toExponential(2);
            const [mantissa, exponent] = exp.split('e');
            const expVal = parseInt(exponent, 10);
            return `${mantissa} × 10^${expVal} ${unit}`;
        };

        let labelY = mouseY - (currentDimensionX !== "none" ? 22 : 10);

        // Move label below ruler if we are below a mark to avoid overlap with interval labels
        if (markedYData !== null && mouseY > yScale(markedYData) + 2) {
            labelY = mouseY + 15;
        }

        // On mobile 2D, force label much higher up to avoid finger occlusion
        if (isMobile && currentDimensionX !== "none") {
            labelY = mouseY - 45;
        }

        const is2DMode = currentDimensionX !== "none";
        const anchor = isMobile ? "middle" : "start";
        const labelX = isMobile ? mouseX : (mouseX + (currentDimensionX !== "none" ? 5 : 15));

        // ... (labelY calculation remains) ...

        const fs = 12;
        const charRatio = 0.6;
        const charWidth = fs * charRatio;

        const getEstBBox = (text, x, y, anchor = "start") => {
            const lines = Array.isArray(text) ? text : [text];
            const maxLen = d3.max(lines, l => l.length) || 0;
            const w = maxLen * charWidth;
            const h = lines.length * fs * 1.2;
            let bx = x;
            if (anchor === "middle") bx = x - w / 2;
            else if (anchor === "end") bx = x - w;
            return { x: bx, y: y - fs * 0.7, width: w, height: h };
        };

        // Clamp a box {x, y, width, height} within [0,0,width,height], return {dx, dy} shift
        const clampBox = (box, pad = 4) => {
            let dx = 0, dy = 0;
            if (box.x - pad < 0) dx = -(box.x - pad);
            else if (box.x + box.width + pad > width) dx = width - (box.x + box.width + pad);
            if (box.y - pad < 0) dy = -(box.y - pad);
            else if (box.y + box.height + pad > height) dy = height - (box.y + box.height + pad);
            return { dx, dy };
        };

        const labelText = currentDimensionX !== "none"
            ? [`Y: ${formatVal(valY, getUnit(currentDimensionY))}`, `X: ${formatVal(xScale.invert(mouseX), getUnit(currentDimensionX))}`]
            : [formatVal(valY, getUnit(currentDimensionY))];

        let lbox = getEstBBox(labelText, labelX, labelY, anchor);
        const { dx: ldx, dy: ldy } = clampBox(lbox);
        const clampedLabelX = labelX + ldx;
        const clampedLabelY = labelY + ldy;
        lbox = { ...lbox, x: lbox.x + ldx, y: lbox.y + ldy };

        rulerLabel.attr("x", clampedLabelX).attr("y", clampedLabelY).attr("text-anchor", anchor);

        // For 2D mode: left-align text within the centered background box
        const tspanX = is2DMode ? (lbox.x + 4) : clampedLabelX;
        const tspanAnchor = is2DMode ? "start" : anchor;
        rulerLabel.selectAll("tspan")
            .data(labelText)
            .join("tspan")
            .attr("x", tspanX)
            .attr("text-anchor", tspanAnchor)
            .attr("dy", (d, i) => i === 0 ? 0 : "1.2em")
            .text(d => d);

        rulerLabelBackground.attr("x", lbox.x - 4).attr("y", lbox.y - 4).attr("width", lbox.width + 8).attr("height", lbox.height + 8);
        rulerLabelHitRect.attr("x", lbox.x - 12).attr("y", lbox.y - 12).attr("width", lbox.width + 24).attr("height", lbox.height + 24);

        const updateIntervalUI = (label, bg, line, hitLine, val, markVal, mousePos, markPos, isHorizontal, dim, orthoPos, orthoMarkPos) => {
            if (markVal === null || Math.abs(mousePos - markPos) < 2) {
                label.style("display", "none");
                bg.style("display", "none");
                line.style("display", "none");
                hitLine.style("display", "none");
                return;
            }

            label.style("display", null);
            bg.style("display", null);
            line.style("display", null);
            hitLine.style("display", null);

            let baseLabelX = 0;
            let isFlipped = false;
            let anchor = "start";

            if (isHorizontal) {
                const drawY = (orthoMarkPos !== null) ? orthoMarkPos : orthoPos;
                line.attr("x1", markPos).attr("x2", mousePos).attr("y1", drawY).attr("y2", drawY);
                hitLine.attr("x1", markPos).attr("x2", mousePos).attr("y1", drawY).attr("y2", drawY);
                isFlipped = (orthoMarkPos !== null && orthoPos > orthoMarkPos);
                const labelY = isFlipped ? drawY - 20 : drawY + 20;
                label.attr("y", labelY).attr("text-anchor", "middle");
                baseLabelX = (mousePos + markPos) / 2;
                anchor = "middle";
            } else {
                const drawX = (orthoMarkPos !== null) ? orthoMarkPos : orthoPos;
                line.attr("x1", drawX).attr("x2", drawX).attr("y1", markPos).attr("y2", mousePos);
                hitLine.attr("x1", drawX).attr("x2", drawX).attr("y1", markPos).attr("y2", mousePos);
                isFlipped = (orthoMarkPos !== null && orthoPos > orthoMarkPos);
                const labelX = isFlipped ? drawX - 15 : drawX + 15;
                anchor = isFlipped ? "end" : "start";
                label.attr("x", labelX).attr("y", (mousePos + markPos) / 2).attr("text-anchor", anchor);
                baseLabelX = labelX;
            }

            const relText = `×${formatRelative(val / markVal)}`;
            const absText = formatAbsolute(val - markVal, dim);
            const tspans = label.selectAll("tspan")
                .data([relText, absText])
                .join("tspan")
                .attr("dy", (d, i) => i === 0 ? 0 : "1.2em")
                .text(d => d);

            let box = getEstBBox([relText, absText], baseLabelX, parseFloat(label.attr("y")), anchor);
            if (isHorizontal) {
                if (isFlipped) label.attr("y", parseFloat(label.attr("y")) - box.height + 15);
                box = getEstBBox([relText, absText], baseLabelX, parseFloat(label.attr("y")), anchor);
            }
            const { dx: idxShift, dy: idyShift } = clampBox(box);
            const clampedX = baseLabelX + idxShift;
            const clampedY = parseFloat(label.attr("y")) + idyShift;
            label.attr("x", clampedX).attr("y", clampedY);
            box = { ...box, x: box.x + idxShift, y: box.y + idyShift };

            // For 2D mode: left-align text within the centered background box
            const tspanXPos = is2DMode ? (box.x + 4) : clampedX;
            const tspanAnchorVal = is2DMode ? "start" : anchor;
            tspans.attr("x", tspanXPos).attr("text-anchor", tspanAnchorVal);

            bg.attr("x", box.x - 4).attr("y", box.y - 4).attr("width", box.width + 8).attr("height", box.height + 8);
        };

        if (markedYData !== null) {
            updateIntervalUI(yIntervalLabel, yIntervalBackground, intervalLineY, intervalHitLineY, valY, markedYData, mouseY, my, false, currentDimensionY, mouseX, mx);
        } else {
            yIntervalLabel.style("display", "none");
            yIntervalBackground.style("display", "none");
            intervalLineY.style("display", "none");
            intervalHitLineY.style("display", "none");
        }

        if (markedXData !== null && currentDimensionX !== "none") {
            updateIntervalUI(xIntervalLabel, xIntervalBackground, intervalLineX, intervalHitLineX, xScale.invert(mouseX), markedXData, mouseX, mx, true, currentDimensionX, mouseY, my);
        } else {
            xIntervalLabel.style("display", "none");
            xIntervalBackground.style("display", "none");
            intervalLineX.style("display", "none");
            intervalHitLineX.style("display", "none");
        }
    }

    function hide() {
        rulerGroup.style("display", "none");
        lastMousePos = null;
        lastMouseDataX = null;
        lastMouseDataY = null;
    }

    return {
        update,
        setMark,
        clearMark,
        hide,
        hide,
        get isDragging() { return _isDragging || _isMarkDragging; }
    };
}
