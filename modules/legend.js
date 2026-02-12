import * as d3 from 'd3';
import { getLocalized } from './utils.js';

/**
 * Creates a legend component that shows active categories with hover filtering.
 */
export function createLegend(svg, g) {
    const legendPadding = 15;
    const legendItemHeight = 20;
    const legendGroup = svg.append("g").attr("class", "legend");
    let legendWidth = 0;
    let legendHeight = 0;

    /**
     * Updates the legend with active categories from the current data.
     * @param {Array} currentData - Currently filtered data items
     * @param {Object} state - { categories, colorScale, language, width, height }
     */
    function updateLegend(currentData, state) {
        const { categories, colorScale, language, width, height } = state;
        if (!categories) return;

        const activeCats = categories.filter(cat =>
            currentData.some(d => getLocalized(d.category, language) === cat)
        );

        legendHeight = activeCats.length * legendItemHeight + legendPadding * 2;
        const texts = legendGroup.selectAll("text").data(activeCats, d => d);
        texts.exit().remove();

        const textEnter = texts.enter().append("text")
            .attr("x", legendPadding).attr("dy", "0.35em")
            .style("font-family", "monospace").style("font-size", "12px").style("cursor", "pointer")
            .attr("fill", d => colorScale ? colorScale(d) : 'black');

        const textMerge = textEnter.merge(texts)
            .attr("y", (d, i) => legendPadding + i * legendItemHeight + legendItemHeight / 2)
            .text(d => d);

        textEnter.on("mouseover", function (event, cat) {
            g.selectAll(".item-group").transition().duration(200)
                .attr("opacity", d => getLocalized(d.category, language) === cat ? 1 : 0.2);
            g.selectAll(".item-group").filter(d => getLocalized(d.category, language) === cat).raise();
        })
            .on("mouseout", function () {
                g.selectAll(".item-group").transition().duration(200).attr("opacity", 1);
                g.selectAll(".item-group").sort((a, b) => d3.ascending(a.id, b.id));
            })
            .on("click", function (event, cat) {
                event.stopPropagation();
                if (state.onCategoryClick) state.onCategoryClick(cat);
            });

        let maxTextWidth = 0;
        textMerge.each(function () {
            const bbox = this.getComputedTextLength();
            if (bbox > maxTextWidth) maxTextWidth = bbox;
        });
        legendWidth = maxTextWidth + legendPadding * 2;
        let rect = legendGroup.select("rect");
        if (rect.empty()) rect = legendGroup.insert("rect", "text").attr("fill", "black").attr("stroke", "#00aaff").attr("stroke-width", 1).attr("rx", 5).attr("ry", 5);
        rect.attr("width", legendWidth).attr("height", legendHeight);

        const legendX = width - legendWidth - 20;
        const legendY = height - legendHeight - 60;
        legendGroup.attr("transform", `translate(${legendX}, ${legendY})`);
    }

    /**
     * Repositions the legend after a resize.
     */
    function reposition(width, height) {
        const legendX = width - legendWidth - 20;
        const legendY = height - legendHeight - 60;
        legendGroup.attr("transform", `translate(${legendX}, ${legendY})`);
    }

    return { updateLegend, reposition };
}
