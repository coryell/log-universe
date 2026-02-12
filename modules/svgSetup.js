import * as d3 from 'd3';
import { paddingLeft, fadeEnd, fadeBottomHeight, paddingBottom } from './constants.js';

/**
 * Creates SVG element, gradient definitions, and mask layers.
 * Returns the SVG, layer groups, and an updateMask function.
 */
export function createSvgLayers(container, width, height) {
    const svg = d3.select(container)
        .append('svg')
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('viewBox', [0, 0, width, height]);

    const defs = svg.append("defs");

    // Horizontal fade gradient (left edge)
    const gradient = defs.append("linearGradient")
        .attr("id", "fade-gradient")
        .attr("gradientUnits", "userSpaceOnUse")
        .attr("x1", 0)
        .attr("x2", fadeEnd)
        .attr("y1", 0)
        .attr("y2", 0);

    gradient.append("stop")
        .attr("offset", paddingLeft / fadeEnd)
        .attr("stop-color", "black");

    gradient.append("stop")
        .attr("offset", "1")
        .attr("stop-color", "white");

    // Vertical fade gradient (bottom edge)
    const verticalGradient = defs.append("linearGradient")
        .attr("id", "fade-gradient-vertical")
        .attr("gradientUnits", "userSpaceOnUse")
        .attr("x1", 0)
        .attr("x2", 0)
        .attr("y1", height)
        .attr("y2", height - fadeBottomHeight);

    verticalGradient.append("stop")
        .attr("offset", 0)
        .attr("stop-color", "black");

    verticalGradient.append("stop")
        .attr("offset", paddingBottom / fadeBottomHeight)
        .attr("stop-color", "black");

    verticalGradient.append("stop")
        .attr("offset", "1")
        .attr("stop-color", "white");

    // Mask elements
    const maskLeft = defs.append("mask")
        .attr("id", "fade-mask-left");

    const maskBottom = defs.append("mask")
        .attr("id", "fade-mask-bottom");

    // Inequality mask
    const createInequalityMask = (id, x1, y1, x2, y2) => {
        const gradId = id + "-grad";
        const grad = defs.append("linearGradient")
            .attr("id", gradId)
            .attr("x1", x1)
            .attr("y1", y1)
            .attr("x2", x2)
            .attr("y2", y2);
        grad.append("stop").attr("offset", "0%").attr("stop-color", "white").attr("stop-opacity", 1);
        grad.append("stop").attr("offset", "10%").attr("stop-color", "white").attr("stop-opacity", 1);
        grad.append("stop").attr("offset", "100%").attr("stop-color", "white").attr("stop-opacity", 0);

        defs.append("mask")
            .attr("id", id)
            .attr("maskContentUnits", "objectBoundingBox")
            .append("rect")
            .attr("x", 0)
            .attr("y", 0)
            .attr("width", 1)
            .attr("height", 1)
            .attr("fill", `url(#${gradId})`);
    };

    createInequalityMask("ineq-fade", "0%", "0%", "100%", "0%");

    // SVG layer groups
    const gridGroup = svg.append("g").attr("class", "grid");
    const xLabelGroup = svg.append("g")
        .attr("class", "x-axis-labels")
        .attr("mask", "url(#fade-mask-left)");
    const yLabelGroup = svg.append("g")
        .attr("class", "y-axis-labels")
        .attr("mask", "url(#fade-mask-bottom)");

    const dataLayerOuter = svg.append('g')
        .attr("class", "data-layer-outer")
        .attr("mask", "url(#fade-mask-left)");

    const g = dataLayerOuter.append('g')
        .attr("class", "data-layer")
        .attr("mask", "url(#fade-mask-bottom)");

    const gCombined = dataLayerOuter.append('g')
        .attr("class", "combined-layer")
        .attr("mask", "url(#fade-mask-bottom)");

    /**
     * Updates the left and bottom fade masks based on current dimensions.
     */
    function updateMask(w, h, currentDimensionX) {
        maskLeft.selectAll("rect").remove();
        maskBottom.selectAll("rect").remove();

        maskLeft.append("rect")
            .attr("x", 0).attr("y", 0)
            .attr("width", fadeEnd).attr("height", h)
            .attr("fill", "url(#fade-gradient)");

        maskLeft.append("rect")
            .attr("x", fadeEnd).attr("y", 0)
            .attr("width", w - fadeEnd).attr("height", h)
            .attr("fill", "white");

        if (currentDimensionX !== "none") {
            svg.select("#fade-gradient-vertical")
                .attr("y1", h)
                .attr("y2", h - fadeBottomHeight);

            maskBottom.append("rect")
                .attr("x", 0).attr("y", h - fadeBottomHeight)
                .attr("width", w).attr("height", fadeBottomHeight)
                .attr("fill", "url(#fade-gradient-vertical)");

            maskBottom.append("rect")
                .attr("x", 0).attr("y", 0)
                .attr("width", w).attr("height", h - fadeBottomHeight)
                .attr("fill", "white");
        } else {
            maskBottom.append("rect")
                .attr("x", 0).attr("y", 0)
                .attr("width", w).attr("height", h)
                .attr("fill", "white");
        }
    }

    return {
        svg,
        defs,
        gridGroup,
        xLabelGroup,
        yLabelGroup,
        dataLayerOuter,
        g,
        gCombined,
        updateMask
    };
}
