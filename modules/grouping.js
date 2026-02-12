import * as d3 from 'd3';
import { getDimensionValueX, getDimensionValueY, getLocalized, getFilteredData } from './utils.js';

/**
 * Applies data grouping: combines data points that share the same coordinates
 * into combined groups with multi-name labels.
 */
export function applyGrouping(g, gCombined, state) {
    const {
        currentDimensionX, currentDimensionY,
        prevDimensionX, prevDimensionY,
        data, colorScale, language,
        xScale, yScale, svg, zoom,
        ruler, width, height, callbacks
    } = state;

    if (currentDimensionX !== prevDimensionX || currentDimensionY !== prevDimensionY || !data) return;
    gCombined.selectAll(".item-group").remove();

    const groups = new Map();
    const filteredData = getFilteredData(data, currentDimensionX, currentDimensionY);

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
            const combinedDisplayName = members.map(m => getLocalized(m.displayName, language)).join(" / ");
            const combinedData = {
                ...first,
                id: `combined-${key}`,
                displayName: { [language]: combinedDisplayName },
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
                .attr('fill', colorScale(getLocalized(first.category, language)));

            const textEl = grp.append('text').attr('class', 'label')
                .attr('x', 10).attr('y', 0).attr('dy', '.35em')
                .style('font-family', 'monospace').style('font-size', `${currentFS}px`);

            members.forEach((m, i) => {
                const name = getLocalized(m.displayName, language);
                const cat = getLocalized(m.category, language);
                textEl.append('tspan').text(name).attr('fill', colorScale(cat));
                if (i < members.length - 1) {
                    const nextCat = getLocalized(members[i + 1].category, language);
                    textEl.append('tspan').text(' / ').attr('fill', colorScale(nextCat));
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
