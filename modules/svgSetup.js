import * as d3 from 'd3';
import { paddingLeft, fadeEnd, fadeBottomHeight, paddingBottom, INEQUALITY_ARROW_LENGTH_FACTOR } from './constants.js';

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

    // Combined mask for mobile (single mask applied to dataLayerOuter)
    const mobileMask = defs.append("mask")
        .attr("id", "mobile-data-mask");

    // Inequality mask
    const createInequalityMask = (id, x1, y1, x2, y2) => {
        const gradId = id + "-grad";
        const grad = defs.append("linearGradient")
            .attr("id", gradId)
            .attr("x1", x1)
            .attr("y1", y1)
            .attr("x2", x2)
            .attr("y2", y2);

        // Calculate the percentage of the rect that corresponds to half a point width (radius)
        // Rect length = factor * radius. Desired opaque length = radius.
        // Opaque stop = 1 / factor
        const opaqueStop = 100 / INEQUALITY_ARROW_LENGTH_FACTOR;

        grad.append("stop").attr("offset", "0%").attr("stop-color", "white").attr("stop-opacity", 1);
        grad.append("stop").attr("offset", `${opaqueStop}%`).attr("stop-color", "white").attr("stop-opacity", 1);
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

    const dataLayerOuter = svg.append('g')
        .attr("class", "data-layer-outer")
        .attr("mask", "url(#fade-mask-left)");

    const g = dataLayerOuter.append('g')
        .attr("class", "data-layer")
        .attr("mask", "url(#fade-mask-bottom)");

    const gCombined = dataLayerOuter.append('g')
        .attr("class", "combined-layer")
        .attr("mask", "url(#fade-mask-bottom)");

    const xLabelGroup = svg.append("g")
        .attr("class", "x-axis-labels");
    const yLabelGroup = svg.append("g")
        .attr("class", "y-axis-labels");

    /**
     * Updates the left and bottom fade masks based on current dimensions.
     * On mobile, uses a single combined mask with no gradient.
     */
    function updateMask(w, h, currentDimensionX, isMobile) {
        maskLeft.selectAll("*").remove();
        maskBottom.selectAll("*").remove();
        mobileMask.selectAll("*").remove();

        // 1. Always populate gradient masks (useful for labels in both modes)
        maskLeft.append("rect")
            .attr("x", 0).attr("y", 0)
            .attr("width", fadeEnd).attr("height", h)
            .attr("fill", "url(#fade-gradient)");

        maskLeft.append("rect")
            .attr("x", fadeEnd).attr("y", 0)
            .attr("width", w - fadeEnd).attr("height", h)
            .attr("fill", "white");

        if (currentDimensionX !== "none") {
            // Dynamic vertical fade parameters
            const mPaddingBottom = isMobile ? paddingBottom : paddingBottom; // Use standard padding
            const mFadeHeight = isMobile ? fadeBottomHeight : fadeBottomHeight; // Use standard fade height

            const vGrad = svg.select("#fade-gradient-vertical");
            vGrad.attr("y1", h).attr("y2", h - mFadeHeight);

            // Update stops for mobile if needed (they use paddingBottom / fadeBottomHeight)
            // But wait, the stops are defined once in defs. We should update them too.
            vGrad.selectAll("stop").remove();
            vGrad.append("stop").attr("offset", 0).attr("stop-color", "black");
            vGrad.append("stop").attr("offset", mPaddingBottom / mFadeHeight).attr("stop-color", "black");
            vGrad.append("stop").attr("offset", "1").attr("stop-color", "white");

            maskBottom.append("rect")
                .attr("x", 0).attr("y", h - mFadeHeight)
                .attr("width", w).attr("height", mFadeHeight)
                .attr("fill", "url(#fade-gradient-vertical)");

            maskBottom.append("rect")
                .attr("x", 0).attr("y", 0)
                .attr("width", w).attr("height", h - mFadeHeight)
                .attr("fill", "white");
        } else {
            maskBottom.append("rect")
                .attr("x", 0).attr("y", 0)
                .attr("width", w).attr("height", h)
                .attr("fill", "white");
        }


        // 2. Apply masking based on mode
        if (isMobile) {
            // Mobile: Data uses cutouts, labels use gradients
            mobileMask.append("rect")
                .attr("x", 0).attr("y", 0)
                .attr("width", w).attr("height", h)
                .attr("fill", "white");

            dataLayerOuter.attr("mask", "url(#mobile-data-mask)");
            g.attr("mask", null);
            gCombined.attr("mask", null);

            xLabelGroup.attr("mask", null);
            yLabelGroup.attr("mask", "url(#fade-mask-bottom)");

        } else {
            // Desktop: Everything uses gradients
            dataLayerOuter.attr("mask", "url(#fade-mask-left)");
            g.attr("mask", "url(#fade-mask-bottom)");
            gCombined.attr("mask", "url(#fade-mask-bottom)");

            xLabelGroup.attr("mask", null);
            yLabelGroup.attr("mask", "url(#fade-mask-bottom)");

        }
    }

    return {
        svg,
        defs,
        gridGroup,
        xLabelGroup,
        yLabelGroup,
        mobileMask,
        dataLayerOuter,
        g,
        gCombined,
        updateMask
    };
}
