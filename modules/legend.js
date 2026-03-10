// Copyright (c) 2026 Cutter Coryell
// SPDX-License-Identifier: MIT

import * as d3 from 'd3';
import { getLocalized } from './utils.js';
import { categories, FADE_OPACITY, LANGUAGE } from './constants.js';

/**
 * Creates a legend component that shows active categories with hover filtering.
 * Renders both an SVG legend (desktop) and an HTML legend (mobile menu).
 */
export function createLegend(svg, g, gCombined) {
    const legendPadding = 15;
    const legendItemHeight = 25; // Increased for button padding
    const legendItemGap = 8;
    const legendGroup = svg.append("g").attr("class", "legend svg-legend");
    let legendWidth = 0;
    let legendHeight = 0;

    const mobileLegend = document.getElementById('mobile-legend');

    function fadeToCategory(cat, language) {
        g.selectAll(".item-group").transition().duration(200)
            .attr("opacity", d => getLocalized(d.category, language) === cat ? 1 : FADE_OPACITY);
        g.selectAll(".item-group").filter(d => getLocalized(d.category, language) === cat).raise();
        gCombined.selectAll(".item-group").transition().duration(200)
            .attr("opacity", d => d._members && d._members.some(m => getLocalized(m.category, language) === cat) ? 1 : FADE_OPACITY);
        gCombined.selectAll(".item-group").filter(d => d._members && d._members.some(m => getLocalized(m.category, language) === cat)).raise();

        // Update SVG Legend
        legendGroup.selectAll(".legend-item-text").transition().duration(200)
            .style("font-weight", d => d === cat ? "bold" : "normal")
            .attr("opacity", d => d === cat ? 1 : FADE_OPACITY);

        legendGroup.selectAll(".legend-item-rect").transition().duration(200)
            .attr("opacity", d => d === cat ? 1 : FADE_OPACITY)
            .attr("stroke", d => d === cat ? "#00aaff" : "#333");

        // Update Mobile Legend
        if (mobileLegend) {
            Array.from(mobileLegend.querySelectorAll('.mobile-legend-item')).forEach(span => {
                if (span.textContent.trim() === cat) {
                    span.style.fontWeight = 'bold';
                    span.style.opacity = '1';
                    span.style.borderColor = '#00aaff';
                } else {
                    span.style.fontWeight = 'normal';
                    span.style.opacity = String(FADE_OPACITY);
                    span.style.borderColor = '#333';
                }
            });
        }
    }

    function unfade() {
        g.selectAll(".item-group").transition().duration(200).attr("opacity", 1);
        gCombined.selectAll(".item-group").transition().duration(200).attr("opacity", 1);

        // Reset SVG Legend
        legendGroup.selectAll(".legend-item-text").transition().duration(200)
            .style("font-weight", "bold")
            .attr("opacity", 1);

        legendGroup.selectAll(".legend-item-rect").transition().duration(200)
            .attr("opacity", 1)
            .attr("stroke", "#333");

        // Reset Mobile Legend
        if (mobileLegend) {
            Array.from(mobileLegend.querySelectorAll('.mobile-legend-item')).forEach(span => {
                span.style.fontWeight = 'bold';
                span.style.opacity = '1';
                span.style.borderColor = '#333';
            });
        }
    }

    /**
     * Updates the legend with active categories from the current data.
     * @param {Array} currentData - Currently filtered data items
     * @param {Object} state - { categories, colorScale, language, width, height, onCategoryClick }
     */
    function updateLegend(currentData, state) {
        const { categories: categoryKeys, colorScale, language, width, height } = state;
        if (!categoryKeys) return;

        const activeCats = categoryKeys.filter(cat =>
            currentData.some(d => getLocalized(d.category, language) === cat)
        );

        // --- SVG Legend (desktop) ---
        const items = legendGroup.selectAll(".legend-item").data(activeCats, d => d);
        items.exit().remove();

        const itemEnter = items.enter().append("g")
            .attr("class", "legend-item")
            .style("cursor", "pointer");

        itemEnter.append("rect")
            .attr("class", "legend-item-rect")
            .attr("fill", "black")
            .attr("stroke", "#333")
            .attr("stroke-width", 1)
            .attr("rx", 4).attr("ry", 4);

        itemEnter.append("text")
            .attr("class", "legend-item-text")
            .attr("dy", "0.35em")
            .style("font-family", "monospace")
            .style("font-size", "12px")
            .style("font-weight", "bold");

        const itemMerge = itemEnter.merge(items);

        // Update positions and text content
        itemMerge.select(".legend-item-text")
            .text(d => categories[d]?.displayName[LANGUAGE] ?? d)
            .attr("fill", d => colorScale ? colorScale(d) : 'white');

        // Calculate dimensions
        let maxTextWidth = 0;
        itemMerge.each(function (d) {
            const text = d3.select(this).select("text");
            const textWidth = text.node().getComputedTextLength();
            if (textWidth > maxTextWidth) maxTextWidth = textWidth;
        });

        const buttonWidth = maxTextWidth + 16; // 8px padding on each side
        legendWidth = buttonWidth + legendPadding * 2;
        legendHeight = activeCats.length * (20 + legendItemGap) + legendPadding * 2;

        // Apply uniform width to all button rectangles
        itemMerge.each(function (d) {
            d3.select(this).select("rect")
                .attr("width", buttonWidth)
                .attr("height", 20)
                .attr("y", -10);

            d3.select(this).select("text")
                .attr("x", buttonWidth / 2)
                .style("text-anchor", "middle");
        });


        // Restore main legend bounding box
        let mainRect = legendGroup.select(".legend-bg");
        if (mainRect.empty()) {
            mainRect = legendGroup.insert("rect", ":first-child")
                .attr("class", "legend-bg")
                .attr("fill", "black")
                .attr("stroke", "#00aaff")
                .attr("stroke-width", 1)
                .attr("rx", 5).attr("ry", 5);
        }
        mainRect.attr("width", legendWidth).attr("height", legendHeight);


        itemMerge.attr("transform", (d, i) =>
            `translate(${legendPadding}, ${legendPadding + i * (20 + legendItemGap) + 10})`
        );

        itemMerge
            .on("pointerenter", (event, cat) => {
                if (event.pointerType === 'touch') return;
                fadeToCategory(cat, language);
            })
            .on("pointerleave", (event) => {
                if (event.pointerType === 'touch') return;
                unfade();
            })
            .on("click", function (event, cat) {
                event.stopPropagation();
                if (state.onCategoryClick) state.onCategoryClick(cat);
            });

        const legendX = width - legendWidth - 20;
        const legendY = height - legendHeight - 60;
        legendGroup.attr("transform", `translate(${legendX}, ${legendY})`);

        // --- HTML Legend (mobile menu) ---
        updateMobileLegend(activeCats, colorScale, language, state.onCategoryClick);
    }

    function updateMobileLegend(activeCats, colorScale, language, onCategoryClick) {
        if (!mobileLegend) return;
        mobileLegend.innerHTML = '';

        activeCats.forEach(cat => {
            const span = document.createElement('span');
            span.className = 'mobile-legend-item';
            span.textContent = categories[cat]?.displayName[LANGUAGE] ?? cat;
            span.style.fontWeight = 'bold';
            span.style.color = colorScale ? colorScale(cat) : '#fff';

            span.addEventListener('click', () => {
                if (onCategoryClick) onCategoryClick(cat);
            });
            mobileLegend.appendChild(span);
        });
    }

    function reposition(width, height) {
        const legendX = width - legendWidth - 20;
        const legendY = height - legendHeight - 60;
        legendGroup.attr("transform", `translate(${legendX}, ${legendY})`);
    }

    return { updateLegend, reposition };
}
