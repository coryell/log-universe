import * as d3 from 'd3';
import { getLocalized, parseValue } from './utils.js';

const renderInequalityAnnotation = (group, dataItem, radius, fs, angle, textWidth, { colorScale, language }) => {
    const inequRect = group.select('.inequality-rect');
    const label = group.select('text.label');
    const bg = group.select('rect.label-bg');
    const hit = group.select('rect.hit-area');
    const circle = group.select('circle');

    // Determine label position based on gradient direction
    const isRightward = Math.abs(angle) < 90;

    if (isRightward) {
        label.attr('x', -10).style('text-anchor', 'end');
        bg.attr('x', -textWidth - 10);
        hit.attr('x', -radius - 10 - textWidth);
    } else {
        label.attr('x', 10).style('text-anchor', 'start');
        bg.attr('x', 8);
        hit.attr('x', -radius - 5);
    }

    // Shared layout
    label.style('font-size', `${fs}px`)
        .style('font-weight', 'bold')
        .attr('y', 0)
        .attr('transform', null);

    bg.attr('y', -fs * 0.7)
        .attr('height', fs * 1.5)
        .attr('width', textWidth)
        .attr('transform', null);

    hit.attr('y', -fs)
        .attr('height', fs * 2)
        .attr('width', radius + 20 + textWidth);

    const isHighlighted = group.classed('highlighted');
    const cat = getLocalized(dataItem.category, language);
    const color = isHighlighted ? 'white' : colorScale(cat);
    const thickness = (2 * radius) + (isHighlighted ? 2 : 0);
    const length = 20 * radius;

    inequRect
        .attr('x', 0)
        .attr('y', -thickness / 2)
        .attr('width', length)
        .attr('height', thickness)
        .attr('fill', color)
        .attr('mask', 'url(#ineq-fade)')
        .attr('transform', `rotate(${angle})`)
        .attr('opacity', 1);

    group.select('.range-line').attr('opacity', 0);
    circle.attr('opacity', 1);
};

const renderRangeAnnotation = (group, dataItem, radius, fs, yInfo, currentYScale, textWidth, { colorScale, language }) => {
    const rangeLine = group.select('.range-line');
    const label = group.select('text.label');
    const bg = group.select('rect.label-bg');
    const hit = group.select('rect.hit-area');

    const isHighlighted = group.classed('highlighted');
    const cat = getLocalized(dataItem.category, language);
    const color = isHighlighted ? 'white' : colorScale(cat);
    const thickness = (0.75 * radius);

    const y1 = currentYScale(yInfo.value);
    const y2 = currentYScale(yInfo.value2);
    const y2_rel = y2 - y1;
    const yMid_rel = y2_rel / 2;

    rangeLine
        .attr('x1', 0).attr('y1', 0)
        .attr('x2', 0).attr('y2', y2_rel)
        .attr('stroke', color)
        .attr('stroke-width', thickness)
        .attr('stroke-linecap', 'round')
        .attr('opacity', 1);

    const rangeFS = fs * 1.75;
    const textLen = (getLocalized(dataItem.displayName, language) || "").length;
    const charWidth = rangeFS * 0.6;
    const rangeTextWidth = textLen * charWidth + 6;
    const labelX = -thickness - 20;
    const labelY = yMid_rel;

    label
        .style('font-size', `${rangeFS}px`)
        .style('font-weight', 'bold')
        .attr('x', labelX)
        .attr('y', labelY)
        .attr('transform', `rotate(-90, ${labelX}, ${labelY})`)
        .style('text-anchor', 'middle');

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

    group.select('.inequality-rect').attr('opacity', 0);
    group.select('circle').attr('opacity', 0);
};

const renderDefaultAnnotation = (group, dataItem, radius, fs, textWidth) => {
    const label = group.select('text.label');
    const bg = group.select('rect.label-bg');
    const hit = group.select('rect.hit-area');
    const circle = group.select('circle');

    label.attr('x', 10)
        .attr('y', 0)
        .style('text-anchor', 'start')
        .style('font-size', `${fs}px`)
        .style('font-weight', 'bold')
        .attr('transform', null);

    bg.attr('x', 8)
        .attr('y', -fs * 0.7)
        .attr('height', fs * 1.5)
        .attr('width', textWidth)
        .attr('transform', null);

    hit.attr('x', -radius - 5)
        .attr('y', -fs)
        .attr('height', fs * 2)
        .attr('width', radius + 20 + textWidth);

    group.select('.inequality-rect').attr('opacity', 0);
    group.select('.range-line').attr('opacity', 0);
    circle.attr('opacity', 1);
};

export const updateItemAnnotations = (selection, radius, fs, currentYScale, { currentDimensionX, currentDimensionY, colorScale, language }) => {
    selection.each(function (d) {
        const group = d3.select(this);
        const dataItem = d._members ? d._members[0] : d;
        const xInfo = currentDimensionX === "none" ? { type: "equal" } : parseValue(dataItem._orig_dimensions[currentDimensionX]);
        const yInfo = parseValue(dataItem._orig_dimensions[currentDimensionY]);

        const text = getLocalized(d.displayName || (d._members && d._members[0].displayName), language);
        const textLen = text ? text.length : 0;
        const charWidth = fs * 0.6;
        const textWidth = textLen * charWidth + 6;

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

        if (showRange && currentYScale) {
            renderRangeAnnotation(group, dataItem, radius, fs, yInfo, currentYScale, textWidth, { colorScale, language });
        } else if (showInequality) {
            renderInequalityAnnotation(group, dataItem, radius, fs, angle, textWidth, { colorScale, language });
        } else {
            renderDefaultAnnotation(group, dataItem, radius, fs, textWidth);
        }
    });
};
