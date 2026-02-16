import * as d3 from 'd3';
import { getLocalized, parseValue } from './utils.js';
import { INEQUALITY_ARROW_LENGTH_FACTOR } from './constants.js';

// Setup phase: computes static properties (text, color, angle, visibility) and applies them.
// This should be called only when data or dimensions change.
export const setupItemAnnotations = (selection, { currentDimensionX, currentDimensionY, colorScale, language }) => {
    selection.each(function (d) {
        const group = d3.select(this);
        const dataItem = d._members ? d._members[0] : d;

        const xInfo = currentDimensionX === "none" ? { type: "equal" } : parseValue(dataItem._orig_dimensions[currentDimensionX]);
        const yInfo = parseValue(dataItem._orig_dimensions[currentDimensionY]);

        const text = getLocalized(d.displayName || (d._members && d._members[0].displayName), language);
        const cat = getLocalized(dataItem.category, language);
        const color = colorScale(cat);

        let angle = 0;
        let showInequality = false;
        let showRange = false;

        if (currentDimensionX === "none") {
            // 1D Mode
            if (yInfo.type === "range") {
                showRange = true;
            } else if (yInfo.type !== "equal") {
                showInequality = true;
                angle = (yInfo.type === "greater") ? -90 : 90;
            }
        } else {
            // 2D Mode
            showRange = false;
            if (xInfo.type !== "range" && yInfo.type !== "range") {
                if (xInfo.type === "greater" && yInfo.type === "greater") angle = -45;
                else if (xInfo.type === "less" && yInfo.type === "greater") angle = -135;
                else if (xInfo.type === "greater" && yInfo.type === "less") angle = 45;
                else if (xInfo.type === "less" && yInfo.type === "less") angle = 135;
                else if (xInfo.type === "greater") angle = 0;
                else if (xInfo.type === "less") angle = 180;
                else if (yInfo.type === "greater") angle = -90;
                else if (yInfo.type === "less") angle = 90;

                if (angle !== 0 || (angle === 0 && (xInfo.type === "greater" || xInfo.type === "less"))) {
                    showInequality = true;
                }
            }
        }

        // Store config for layout phase
        this._annotationConfig = {
            angle,
            showInequality,
            showRange,
            yInfo, // Needed for range coordinates
            text,
            color,
            isRightward: Math.abs(angle) < 90
        };

        // Apply Static Attributes
        if (!d._members) {
            group.select('text.label').text(text).attr('fill', color);
            group.select('circle').attr('fill', color);
        }

        group.select('.range-line').attr('opacity', showRange ? 1 : 0);
        group.select('.inequality-rect').attr('opacity', showInequality ? 1 : 0);
        group.select('circle').attr('opacity', showRange ? 0 : 1);

        if (showInequality) {
            group.select('.inequality-rect')
                .attr('fill', color)
                .attr('mask', 'url(#ineq-fade)')
                .attr('transform', `rotate(${angle})`);
        }

        if (showRange) {
            const rangeLine = group.select('.range-line');
            rangeLine.attr('stroke', color).attr('stroke-linecap', 'round');
        }
    });
};

// Layout phase: updates positions, sizes, and highlight states. 
// Called every render frame.
export const updateAnnotationLayout = (selection, radius, fs, currentYScale, prevYScale, p) => {
    const charWidth = fs * 0.6;

    selection.each(function (d) {
        const config = this._annotationConfig;
        if (!config) return;

        const group = d3.select(this);
        const { angle, showInequality, showRange, yInfo, text, color, isRightward } = config;
        const isHighlighted = group.classed('highlighted');

        const effectiveColor = isHighlighted ? 'white' : color;

        const label = group.select('text.label');
        const bg = group.select('rect.label-bg');
        const hit = group.select('rect.hit-area');

        const textLen = text ? text.length : 0;
        const textWidth = textLen * charWidth + 6;

        label.style('font-size', `${fs}px`);

        if (showRange && currentYScale) {
            // Range Layout
            const thickness = (0.75 * radius);
            const y1 = currentYScale(yInfo.value);
            const y2 = currentYScale(yInfo.value2);
            let y2_rel = y2 - y1;

            // Interpolate range length if transitioning
            if (prevYScale && d._prevRangeV1 !== undefined && p !== undefined) {
                const oldY1 = prevYScale(d._prevRangeV1);
                const oldY2 = prevYScale(d._prevRangeV2);
                const oldY2_rel = oldY2 - oldY1;
                y2_rel = oldY2_rel + (y2_rel - oldY2_rel) * p;
            }

            const yMid_rel = y2_rel / 2;

            const rangeLine = group.select('.range-line');
            rangeLine
                .attr('x1', 0).attr('y1', 0)
                .attr('x2', 0).attr('y2', y2_rel)
                .attr('stroke', effectiveColor)
                .attr('stroke-width', thickness);

            const rangeFS = fs * 1.75;
            const rCharWidth = rangeFS * 0.6;
            const rangeTextWidth = textLen * rCharWidth + 6;
            const labelX = -thickness - 20;
            const labelY = yMid_rel;

            label
                .style('font-size', `${rangeFS}px`)
                .attr('x', labelX)
                .attr('y', labelY)
                .attr('transform', `rotate(-90, ${labelX}, ${labelY})`)
                .style('text-anchor', 'middle')
                .attr('fill', effectiveColor);

            bg
                .attr('x', labelX - rangeTextWidth / 2)
                .attr('y', labelY - rangeFS * 0.75)
                .attr('width', rangeTextWidth)
                .attr('height', rangeFS * 1.5)
                .attr('transform', `rotate(-90, ${labelX}, ${labelY})`);

            hit
                .attr('x', labelX - rangeFS)
                .attr('y', Math.min(0, y2_rel) - rangeFS)
                .attr('width', rangeFS * 2 + Math.abs(labelX))
                .attr('height', Math.abs(y2_rel) + rangeFS * 2);

        } else if (showInequality) {
            // Inequality Layout
            const thickness = (2 * radius) + (isHighlighted ? 2 : 0);
            const length = INEQUALITY_ARROW_LENGTH_FACTOR * radius;

            group.select('.inequality-rect')
                .attr('y', -thickness / 2)
                .attr('width', length)
                .attr('height', thickness)
                .attr('fill', effectiveColor);

            if (isRightward) {
                label.attr('x', -10).style('text-anchor', 'end');
                bg.attr('x', -textWidth - 10);
                hit.attr('x', -radius - 10 - textWidth);
            } else {
                label.attr('x', 10).style('text-anchor', 'start');
                bg.attr('x', 8);
                hit.attr('x', -radius - 5);
            }

            label.attr('y', 0).attr('transform', null).attr('fill', effectiveColor);
            bg.attr('y', -fs * 0.7).attr('height', fs * 1.5).attr('width', textWidth).attr('transform', null);
            hit.attr('y', -fs).attr('height', fs * 2).attr('width', radius + 20 + textWidth);

        } else {
            // Default Layout
            label.attr('x', 10).attr('y', 0).style('text-anchor', 'start').attr('transform', null).attr('fill', effectiveColor);
            bg.attr('x', 8).attr('y', -fs * 0.7).attr('height', fs * 1.5).attr('width', textWidth).attr('transform', null);
            hit.attr('x', -radius - 5).attr('y', -fs).attr('height', fs * 2).attr('width', radius + 20 + textWidth);

            group.select('circle').attr('fill', effectiveColor);
        }
    });
};
