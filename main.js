import * as d3 from 'd3';
import './style.css';
import { getMatches, getHighlightedText, getLocalized, getSearchResultContent } from './search.js';

const LANGUAGE = "en-us";

const app = document.getElementById('app');
const width = app.clientWidth;
const height = app.clientHeight;

const svg = d3.select('#app')
  .append('svg')
  .attr('width', '100%')
  .attr('height', '100%')
  .attr('viewBox', [0, 0, width, height]);

// Define Gradients and Masks
const defs = svg.append("defs");

const paddingLeft = 80;
const fadeEnd = 160;

const gradient = defs.append("linearGradient")
  .attr("id", "fade-gradient")
  .attr("gradientUnits", "userSpaceOnUse") // Anchors to screen coordinates
  .attr("x1", 0)
  .attr("x2", fadeEnd) // Gradient ends at 160px
  .attr("y1", 0)
  .attr("y2", 0);

// Stop 1: Fully transparent (Black in mask = hidden) up to 40px
gradient.append("stop")
  .attr("offset", paddingLeft / fadeEnd) // approx 33%
  .attr("stop-color", "black");

// Stop 2: Transition to visible (White in mask = visible) at 120px
gradient.append("stop")
  .attr("offset", "1") // 100% of x2 (120px)
  .attr("stop-color", "white");

const mask = defs.append("mask")
  .attr("id", "fade-mask");

mask.append("rect")
  .attr("width", width)
  .attr("height", height)
  .attr("fill", "url(#fade-gradient)");

// Create a separate group for the grid so it doesn't pan horizontally
// We want it to be behind the points, so append it first, or use insert before 'g' if 'g' existed.
// Since 'g' is not created yet, we can just append.
const gridGroup = svg.append("g")
  .attr("class", "grid");

// Group for the visualization content that will be transformed (zoomed/panned)
// Group for the visualization content that will be transformed (zoomed/panned)
const g = svg.append('g')
  .attr("class", "data-layer")
  .attr("mask", "url(#fade-mask)");

d3.json('/data.json').then(data => {
  // Convert lengths to numbers just in case
  data.forEach(d => {
    d.length = +d.length;
  });

  // Calculate domain extent
  const minLength = d3.min(data, d => d.length);
  const maxLength = d3.max(data, d => d.length);

  // Calculate X extent
  const minX = d3.min(data, d => d.x) || 0;
  const maxX = d3.max(data, d => d.x) || 1;

  // Setup Log Scale
  const yScale = d3.scaleLog()
    .domain([minLength, maxLength])
    .range([height - 50, 50]); // Add some padding

  // Dynamic X scale based on columns
  // Dynamic X scale to match Y scale aspect ratio (1 unit x = 1 decade y)
  // We want the visual distance of 1 unit in X to equal the visual height of 1 decade in Y
  const decadeHeight = Math.abs(yScale(10) - yScale(1));

  // Center the data horizontally on the screen
  const xCenter = (minX + maxX) / 2;
  const screenCenter = width / 2;

  const xScale = d3.scaleLinear()
    // Map [xCenter] to [screenCenter], and [xCenter + 1] to [screenCenter + decadeHeight]
    .domain([xCenter, xCenter + 1])
    .range([screenCenter, screenCenter + decadeHeight]);

  // Function to update the grid
  const updateGrid = (transform) => {
    // Rescale ONLY the Y scale
    const newYScale = transform.rescaleY(yScale);
    // Rescale ONLY the X scale
    const newXScale = transform.rescaleX(xScale);

    const padding = 200; // Pixels to render off-screen

    // --- Horizontal Grid (Y-Axis Log Scale) ---
    // Generate ticks for a padded area so they don't disappear at the edge
    // Get values corresponding to screen edges + padding
    const yStart = newYScale.invert(height + padding);
    const yEnd = newYScale.invert(-padding);
    // Create a temporary scale for tick generation
    const paddedYScale = newYScale.copy().domain([
      d3.min([yStart, yEnd]),
      d3.max([yStart, yEnd])
    ]);

    // Use standard D3 log ticks on the padded scale
    // Increase count slightly to account for larger area
    const yTickValues = paddedYScale.ticks(15, "~e");

    // Determine the "stride" (how many decades between major ticks)
    // We filter for integer powers of 10 to find the "main" grid lines
    const mainYTicks = yTickValues.filter(d => {
      const log = Math.log10(d);
      return Math.abs(log - Math.round(log)) < 1e-6; // Integer check with epsilon
    });

    let stride = 1;
    if (mainYTicks.length >= 2) {
      const log1 = Math.log10(mainYTicks[0]);
      const log2 = Math.log10(mainYTicks[1]);
      stride = Math.abs(Math.round(log2) - Math.round(log1));
    }
    // If we have 0 or 1 tick, we can't determine stride, default to 1 or keep previous? 
    // Default 1 is safe.

    gridGroup.selectAll(".horizontal-grid").data([null]).join("g")
      .attr("class", "horizontal-grid")
      .call(d3.axisRight(newYScale)
        .tickValues(yTickValues) // Explicitly use the generated values
        .tickSize(width) // Extends ticks across the screen
        .tickFormat(d => {
          const log10 = Math.log10(d);
          // Only label integer powers of 10 to keep it clean, 
          // but draw lines for all ticks d3 generates.
          if (Number.isInteger(log10)) {
            return `10^${log10} m`;
          }
          return "";
        })
      );

    gridGroup.select(".horizontal-grid .domain").remove();

    // --- Vertical Grid (X-Axis Linear Scale) ---
    // Calculate the pixel height of ONE decade (regardless of stride)
    const decadeHeight = Math.abs(newYScale(10) - newYScale(1));

    // Calculate how many X-units correspond to ONE decade's pixel height
    const xZero = newXScale.invert(0);
    const xDist = newXScale.invert(decadeHeight) - xZero;

    // The final spacing is the base unit width * the stride
    const spacing = Math.abs(xDist) * stride;

    // Generate ticks based on this spacing, anchored at 0
    const xTicks = [];

    // Start from the first multiple of spacing >= xMin (padded)
    // Get padded bounds
    const xMinPadded = newXScale.invert(-padding);
    const xMaxPadded = newXScale.invert(width + padding);

    // Handle potential division by zero or infinite spacing
    if (spacing > 0 && isFinite(spacing)) {
      // Ensure we start aligned to the grid, even if xMinPadded is far off
      const start = Math.ceil(xMinPadded / spacing) * spacing;
      // Loop until xMaxPadded
      // Safety cap: don't let it run infinite if logic fails
      let current = start;
      const safetyLimit = 1000;
      let count = 0;
      // Simple direction check: xMaxPadded > xMinPadded usually, but scale could be inverted?
      // Linear scale usually [0, width]. Invert(0) < invert(width).
      // So current should increase.
      while (current <= xMaxPadded && count < safetyLimit) {
        xTicks.push(current);
        current += spacing;
        count++;
      }
    }

    gridGroup.selectAll(".vertical-grid").data([null]).join("g")
      .attr("class", "vertical-grid")
      .attr("mask", "url(#fade-mask)") // Apply fade mask to vertical lines
      .call(d3.axisBottom(newXScale)
        .tickValues(xTicks)
        .tickFormat("") // No labels requested
        .tickSize(height)
      );

    // Apply styles (must be done after every call() as D3 resets them)
    // Horizontal Styles
    gridGroup.selectAll(".horizontal-grid .tick line")
      .attr("stroke", "#00aaff")
      .attr("stroke-dasharray", "2,2")
      .attr("stroke-opacity", d => {
        const log10 = Math.log10(d);
        // Major lines (integer powers of 10) are more opaque
        return Number.isInteger(log10) ? 0.4 : 0.25;
      });

    gridGroup.selectAll(".horizontal-grid .tick text")
      .attr("x", 10)
      .attr("dy", -4)
      .attr("fill", "#00aaff")
      .attr("opacity", 1.0) // Match point labels (assumed 1.0)
      .style("font-family", "monospace")
      .style("font-size", "12px"); // Explicitly match point label size if needed

    gridGroup.select(".horizontal-grid .domain").remove();

    // Vertical Styles
    gridGroup.selectAll(".vertical-grid .tick line")
      .attr("stroke", "#00aaff")
      .attr("stroke-opacity", 0.4) // Increased from 0.2
      .attr("stroke-dasharray", "2,2");

    gridGroup.selectAll(".vertical-grid .tick text")
      .attr("y", height - 20) // Position labels at bottom
      .attr("dx", 5)
      .attr("fill", "#00aaff")
      .attr("opacity", 0.5)
      .style("font-family", "monospace");

    gridGroup.select(".vertical-grid .domain").remove();
  };

  // Define Categorical Color Scale
  const categories = [
    "Atoms / Elements", "Astronomy", "Biology", "Density", "Electromagnetic", "Fundamental / Nuclear",
    "Geology", "Molecules", "Sound", "Technology", "Waves"
  ];
  const colors = [
    "#00FFFF", "#FFD700", "#7CFC00", "#FF8C00", "#1E90FF", "#FF00FF",
    "#CD853F", "#ff0000ff", "#FF69B4", "#C0C0C0", "#9370DB"
  ];
  const colorScale = d3.scaleOrdinal().domain(categories).range(colors);

  // Initial draw with identity transform
  updateGrid(d3.zoomIdentity);

  // Calculate initial font size based on axes (height of one decade)
  const initialDecadeHeight = Math.abs(yScale(10) - yScale(1));
  const initialFS = Math.min(12, initialDecadeHeight);

  // Draw Points (radius proportional to font size)
  // Draw Points and Labels using Groups
  const initialRadius = initialFS / 2.4;

  const items = g.selectAll('.item-group')
    .data(data)
    .join('g')
    .attr('class', 'item-group')
    .attr('transform', d => `translate(${xScale(d.x)}, ${yScale(d.length)})`);

  // Hit Area (Transparent Rect)
  items.append('rect')
    .attr('class', 'hit-area')
    .attr('x', -initialRadius - 5)
    .attr('y', -initialFS)
    .attr('width', 100) // Generous width to cover gap and part of label
    .attr('height', initialFS * 2)
    .attr('fill', 'transparent')
    .style('cursor', 'pointer');

  // Circle
  items.append('circle')
    .attr('cx', 0)
    .attr('cy', 0)
    .attr('r', initialRadius)
    .attr('fill', d => colorScale(getLocalized(d.category, LANGUAGE))); // i18n update

  // Label
  items.append('text')
    .attr('class', 'label')
    .attr('x', 10)
    .attr('y', 0)
    .attr('dy', '.35em')
    .text(d => getLocalized(d.displayName, LANGUAGE)) // i18n update
    .attr('fill', d => colorScale(getLocalized(d.category, LANGUAGE))) // i18n update
    .style('font-family', 'monospace')
    .style('font-size', `${initialFS}px`);

  // Zoom Behavior
  const buffer = 300; // Visual buffer in pixels to allow labels to clear the edge/fade
  const zoom = d3.zoom()
    .scaleExtent([1, 1000000]) // Prevent zooming out past initial view, allow massive zoom in
    .translateExtent([[-300, -300], [width + 300, height + 300]]) // Initial constraint
    .on('zoom', (event) => {
      const t = event.transform;

      // Percentage-based Pan Limits Logic:
      // We want to ensure that the data bounds [x0, x1] never move too far off screen.
      // Constraint: t.applyX(x0) <= a * width  AND  t.applyX(x1) >= (1-a) * width
      // This is achieved by setting translateExtent boundaries extX0 and extX1.
      const a = 0.5; // Allow data to shift up to 80% across the screen
      const extX0 = xScale(minX) - (a * width) / t.k;
      const extX1 = xScale(maxX) + (a * width) / t.k;
      const extY0 = yScale(maxLength) - (a * height) / t.k; // Use maxLength for top of screen
      const extY1 = yScale(minLength) + (a * height) / t.k; // Use minLength for bottom of screen

      zoom.translateExtent([
        [extX0, extY0],
        [extX1, extY1]
      ]);

      // Update grid with new transform
      updateGrid(t);

      // Semantic Zoom: Rescale scales based on transform
      // We rescale X to handle horizontal panning/zooming
      const newXScale = t.rescaleX(xScale);
      // Rescale Y to handle vertical panning/zooming
      const newYScale = t.rescaleY(yScale);

      // Axes-Relative Label Scaling Logic
      const currentDecadeHeight = Math.abs(newYScale(10) - newYScale(1));
      const currentFS = Math.min(12, currentDecadeHeight);
      const currentRadius = currentFS / 2.4;

      // Update Group Positions
      g.selectAll('.item-group')
        .attr('transform', d => `translate(${newXScale(d.x)}, ${newYScale(d.length)})`);

      // Update Sizes (Semantic Zoom)
      g.selectAll('.item-group circle')
        .attr('r', currentRadius);

      g.selectAll('.item-group text.label')
        .style('font-size', `${currentFS}px`);

      // Update Hit Area Size
      g.selectAll('.item-group rect.hit-area')
        .attr('x', -currentRadius - 5)
        .attr('y', -currentFS)
        .attr('height', currentFS * 2);
    });

  svg.call(zoom);

  // Recenter logic
  d3.select('#recenter-btn').on('click', () => {
    svg.transition()
      .duration(750)
      .ease(d3.easeCubicInOut)
      .call(zoom.transform, d3.zoomIdentity);
  });

  // Legend
  const legendPadding = 15;
  const legendItemHeight = 20;
  const legendWidth = 260;
  const legendHeight = categories.length * legendItemHeight + legendPadding * 2;

  const legendX = width - legendWidth - 20;
  const legendY = height - legendHeight - 20;

  const legend = svg.append("g")
    .attr("class", "legend")
    .attr("transform", `translate(${legendX}, ${legendY})`);

  // Legend Box
  legend.append("rect")
    .attr("width", legendWidth)
    .attr("height", legendHeight)
    .attr("fill", "black")
    .attr("stroke", "#00aaff")
    .attr("stroke-width", 1);

  // Legend Items
  categories.forEach((cat, i) => {
    legend.append("text")
      .attr("x", legendPadding)
      .attr("y", legendPadding + i * legendItemHeight + legendItemHeight / 2)
      .attr("dy", "0.35em")
      .text(cat)
      .attr("fill", colorScale(cat))
      .style("font-family", "monospace")
      .style("font-size", "12px")
      .style("cursor", "pointer")
      .on("mouseover", function () {
        // Dim all groups that don't match
        g.selectAll(".item-group")
          .transition().duration(200)
          .attr("opacity", d => getLocalized(d.category, LANGUAGE) === cat ? 1 : 0.2);

        // Bring matching groups to front
        g.selectAll(".item-group").filter(d => getLocalized(d.category, LANGUAGE) === cat).raise();
      })
      .on("mouseout", function () {
        // Restore opacity
        g.selectAll(".item-group")
          .transition().duration(200)
          .attr("opacity", 1);

        // Restore sort order
        g.selectAll(".item-group").sort((a, b) => d3.ascending(a.id, b.id));
      })
      .on("click", function (event, d) {
        // Filter data for this category
        const categoryData = data.filter(item => getLocalized(item.category, LANGUAGE) === cat); // i18n update
        if (categoryData.length === 0) return;

        // Calculate bounding box in default screen coordinates
        // We use the default xScale and yScale (before any zoom transform)
        const xValues = categoryData.map(d => xScale(d.x));
        const yValues = categoryData.map(d => yScale(d.length));

        let minX = d3.min(xValues);
        let maxX = d3.max(xValues);
        let minY = d3.min(yValues);
        let maxY = d3.max(yValues);

        // Add padding and space for labels
        const padding = 20;
        const labelAllowance = 100; // Estimate for label width on the right

        minX -= padding;
        maxX += labelAllowance;
        minY -= padding;
        maxY += padding;

        const boundsWidth = maxX - minX;
        const boundsHeight = maxY - minY;

        // Calculate scale and translation to fit
        // Scale must fit both width and height
        const scale = 0.95 / Math.max(boundsWidth / width, boundsHeight / height);

        // Clamp scale to extent
        const clampedScale = Math.min(Math.max(scale, 1), 1000000); // Respect min scale 1

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        const translate = [
          width / 2 - centerX * clampedScale,
          height / 2 - centerY * clampedScale
        ];

        const transform = d3.zoomIdentity
          .translate(translate[0], translate[1])
          .scale(clampedScale);

        svg.transition()
          .duration(750)
          .call(zoom.transform, transform);
      });
  });



  // Search Implementation
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  let selectedIndex = -1;

  // Render Dropdown
  function renderResults(matches, query) {
    searchResults.innerHTML = '';
    selectedIndex = -1;

    if (matches.length === 0) {
      searchResults.style.display = 'none';
      return;
    }

    matches.forEach((d, index) => {
      const div = document.createElement('div');
      div.className = 'search-result-item';

      div.innerHTML = getSearchResultContent(d, query, LANGUAGE); // Updated to handle tags

      div.addEventListener('click', () => {
        selectResult(d);
      });

      div.addEventListener('mouseenter', () => {
        selectedIndex = index;
        updateSelection();
      });

      searchResults.appendChild(div);
    });

    searchResults.style.display = 'block';
  }

  // Helper functions for highlighting
  function highlightItem(d) {
    items.classed("highlighted", false); // Reset others
    items.filter(item => item.id === d.id).classed("highlighted", true);
    items.filter(item => item.id === d.id).raise(); // Bring to front
  }

  function unhighlightItems() {
    items.classed("highlighted", false);
  }

  // Select Result & Zoom
  function selectResult(d) {
    searchInput.value = getLocalized(d.displayName, LANGUAGE); // i18n update
    searchResults.style.display = 'none';

    // Highlight immediately
    highlightItem(d);

    // Show Infobox immediately
    showInfobox(d);

    // Zoom to point logic
    // We want to center (d.x, d.length)
    // Calculate scale to show roughly 3 decades vertically
    const domain = yScale.domain();
    const totalDecades = Math.log10(domain[1]) - Math.log10(domain[0]);
    const availableHeight = height - 100; // From yScale range [height - 50, 50]

    // We want 3 decades to fill the screen height
    // k = (height * totalDecades) / (3 * availableHeight)
    let targetScale = (height * totalDecades) / (3 * availableHeight);

    // Dynamic Zoom Constraint: Keep nearest neighbor visible
    // 1. Calculate distance to nearest neighbor in base screen coordinates (transform k=1)
    let minDiff = Infinity;
    const x1 = xScale(d.x);
    const y1 = yScale(d.length);

    data.forEach(p => {
      if (p.id === d.id) return; // Skip self
      const x2 = xScale(p.x);
      const y2 = yScale(p.length);
      const dist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
      if (dist < minDiff) minDiff = dist;
    });

    if (minDiff !== Infinity) {
      // 2. We want the nearest neighbor to be ON SCREEN.
      // Use min(width, height) / 2.2 to give some padding.
      const safeRadius = Math.min(width, height) / 2.2;
      const maxScaleForNeighbor = safeRadius / minDiff;

      targetScale = Math.min(targetScale, maxScaleForNeighbor);
    }

    // Clamp scale reasonably
    targetScale = Math.max(1, Math.min(targetScale, 1000));
    const x = xScale(d.x);
    const y = yScale(d.length);

    const transform = d3.zoomIdentity
      .translate(width / 2, height / 2) // Center of screen
      .scale(targetScale)
      .translate(-x, -y); // Move point to center

    svg.transition()
      .duration(1500)
      .call(zoom.transform, transform);

    // Optional: Trigger highlight effect for category?
    // For now, just zoom.
  }

  // Keyboard Navigation
  function updateSelection() {
    const items = searchResults.querySelectorAll('.search-result-item');
    items.forEach((item, index) => {
      if (index === selectedIndex) {
        item.classList.add('selected');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('selected');
      }
    });
  }

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value;
    const matches = getMatches(data, query, LANGUAGE);
    renderResults(matches, query);
  });

  searchInput.addEventListener('focus', () => {
    const query = searchInput.value;
    if (query) {
      const matches = getMatches(data, query, LANGUAGE);
      renderResults(matches, query);
    }
    // ensure the list starts at the top
    searchResults.scrollTop = 0;
  });

  searchInput.addEventListener('keydown', (e) => {
    const items = searchResults.querySelectorAll('.search-result-item');
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      selectedIndex = (selectedIndex + 1) % items.length;
      updateSelection();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      selectedIndex = (selectedIndex - 1 + items.length) % items.length;
      updateSelection();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (selectedIndex >= 0) {
        // Select highlighted
        // Re-run match to get data object properly (or store it on DOM element)
        // Simpler: use the data from the index of matches
        const query = searchInput.value;
        const matches = getMatches(data, query, LANGUAGE);
        if (matches[selectedIndex]) {
          selectResult(matches[selectedIndex]);
        }
      } else if (items.length > 0) {
        // Default to first item if none selected
        const query = searchInput.value;
        const matches = getMatches(data, query, LANGUAGE);
        if (matches[0]) {
          selectResult(matches[0]);
        }
      }
      e.preventDefault();
    } else if (e.key === 'Escape') {
      searchResults.style.display = 'none';
    }
  });

  // Hide dropdown on clicking outside
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
      searchResults.style.display = 'none';
    }
  });

  // Global keydown listener to auto-focus search
  document.addEventListener('keydown', (e) => {
    // Ignore if search input is already focused
    if (document.activeElement === searchInput) return;

    // Ignore if holding modifier keys (Ctrl, Meta, Alt)
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Clear search on Delete or Backspace
    if (e.key === 'Delete' || e.key === 'Backspace') {
      searchInput.value = '';
      renderResults([], ''); // Clear results manually
      searchInput.focus();
      return;
    }

    // Ignore if key is not a single printable character
    // This avoids focusing on Arrow keys, Escape, Enter, etc. unless they produce input
    if (e.key.length === 1) {
      searchInput.focus();
      // Allow default action so the character is typed into the input
    }
  });


  // Infobox Implementation
  const infobox = d3.select("body").append("div")
    .attr("class", "infobox")
    .style("display", "none");

  function showInfobox(d) {
    // Highlight the item
    highlightItem(d);

    const localizedDisplayName = getLocalized(d.displayName, LANGUAGE); // i18n update
    const localizedCategory = getLocalized(d.category, LANGUAGE); // i18n update
    let tagsContent = "";
    if (d.tags && d.tags[LANGUAGE]) {
      tagsContent = `<div class="infobox-row"><span class="infobox-label">Tags:</span>${d.tags[LANGUAGE].join(", ")}</div>`;
    }

    // specific format: [i.j x 10^k] m
    let lengthContent = "";
    let lengthTextForCopy = "";
    if (d.length !== undefined && d.length !== null) {
      // Calculate significant figures from the source string in data.json if possible
      // But here we have d.length as a number. In JS, 640 is just 640.
      // The user says: "for integer values like 640, assume the number of sig figs is the number of digits before the trailing zeros"
      // So 640 -> 2 sig figs (6, 4). 600 -> 1 sig fig (6). 641 -> 3 sig figs.
      // For floating points like 1.2e5, it's harder to know from the number alone.
      // Helper to count sig figs from a number:

      const formatWithSigFigs = (num) => {
        let n = num;
        if (n === 0) return "0";

        // Handle integers specifically for the trailing zero rule
        if (Number.isInteger(n) && !n.toString().includes('e')) {
          const s = Math.abs(n).toString();
          // Count digits excluding trailing zeros
          const trimmed = s.replace(/0+$/, '');
          const sigFigs = trimmed.length;

          // If we have 640, sigFigs is 2. 
          // Scientific notation: 6.4 x 10^2
          // Formula: n.toExponential(sigFigs - 1)
          return n.toExponential(Math.max(0, sigFigs - 1));
        }

        // For non-integers or very large numbers already in scientific notation (which JS handles automatically for >1e21)
        // We will fallback to 3 sig figs (2 decimal places) as a default if we can't infer otherwise, 
        // OR try to infer from string if we had it. Since we don't store the original string, 
        // we'll try a heuristic or just stick to the requested integer rule + standard for others.
        // User only specified the rule for integers. Let's stick to 2 decimal places (3 sig figs) for others for consistency with previous,
        // unless they look like simple integers.
        return n.toExponential(2);
      };

      const exp = formatWithSigFigs(d.length);
      const [mantissa, exponent] = exp.split('e');
      const expVal = parseInt(exponent, 10);
      lengthTextForCopy = `${mantissa} × 10^${expVal} m`;
      lengthContent = `<div class="infobox-row"><span class="infobox-label">Length:</span>${lengthTextForCopy}<button class="copy-btn">Copy</button></div>`;
    }

    const categoryColor = colorScale(localizedCategory);

    infobox.html(`
      <div class="infobox-title">${localizedDisplayName}</div>
      ${lengthContent}
      <div class="infobox-row"><span class="infobox-label">Category:</span><span style="color: ${categoryColor}">${localizedCategory}</span></div>
      ${tagsContent}
    `)
      .style("display", "block");

    // Attach copy event listener
    if (lengthTextForCopy) {
      infobox.select(".copy-btn").on("click", function (event) {
        event.stopPropagation();
        navigator.clipboard.writeText(lengthTextForCopy).then(() => {
          const btn = d3.select(this);
          const originalText = btn.text();
          btn.text("Copied!");
          setTimeout(() => btn.text(originalText), 2000);
        }).catch(err => {
          console.error('Failed to copy text: ', err);
        });
      });
    }
    // Positioning is handled by CSS (bottom-left)
  }

  function hideInfobox() {
    infobox.style("display", "none");
    unhighlightItems(); // Remove highlight
  }

  // Event Listeners for Infobox
  // Attach to the entire group
  g.selectAll(".item-group")
    .on("click", (event, d) => {
      showInfobox(d);
      event.stopPropagation(); // Prevent SVG click from hiding it
    })
    .on("dblclick", (event, d) => {
      selectResult(d);
      event.stopPropagation(); // Stop zoom behavior if any, though selectResult triggers its own zoom
    });

  // Hide on background click

  // Hide on background click
  svg.on("click", () => {
    hideInfobox();
  });

  // Modify Search Selection to show Infobox

  const rulerGroup = svg.append("g")
    .attr("class", "cursor-ruler")
    .style("pointer-events", "none") // Let mouse events pass through
    .style("display", "none");

  const rulerLine = rulerGroup.append("line")
    .attr("x1", 0)
    .attr("x2", width)
    .attr("stroke", "red")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "4,2");

  const rulerLabelBackground = rulerGroup.append("rect")
    .attr("fill", "black")
    .attr("rx", 4)
    .attr("ry", 4)
    .attr("opacity", 0.7);

  const rulerLabel = rulerGroup.append("text")
    .attr("fill", "white")
    .style("font-family", "monospace")
    .style("font-size", "12px")
    .attr("dy", "0.35em")
    .attr("text-anchor", "start");

  // Track the current transform to correctly invert Y
  let currentTransform = d3.zoomIdentity;

  // We need to listen on the SVG (or a transparent rect covering it)
  // The 'zoom' behavior on svg consumes events, so we hook into it or append a listener
  // Since 'zoom' is on svg, standard mousemove might be blocked or consumed?
  // Actually d3.zoom doesn't stop propagation of mousemove by default unless it's dragging.

  svg.on("mousemove", (event) => {
    // Show ruler
    rulerGroup.style("display", null);

    const [mouseX, mouseY] = d3.pointer(event);

    // Update Line Position
    rulerLine
      .attr("y1", mouseY)
      .attr("y2", mouseY);

    // Calculate Value
    // We need the Rescaled Y Scale to invert correctly
    const newYScale = currentTransform.rescaleY(yScale);
    const value = newYScale.invert(mouseY);

    // Format Value (Scientific Notation)
    const formattedValue = value.toExponential(2) + " m";

    // Update Label
    rulerLabel
      .attr("x", 10) // Left aligned
      .attr("y", mouseY - 10)
      .text(formattedValue);

    // Update Label Background
    const bbox = rulerLabel.node().getBBox();
    rulerLabelBackground
      .attr("x", bbox.x - 4)
      .attr("y", bbox.y - 4)
      .attr("width", bbox.width + 8)
      .attr("height", bbox.height + 8);
  });

  svg.on("mouseleave", () => {
    rulerGroup.style("display", "none");
  });

  // Hook into existing zoom listener to update currentTransform
  // We need to modify the existing zoom handler to update our variable
  // BUT we can't easily modify the existing function closure.
  // Instead, we can inspect d3.zoomTransform(svg.node()) inside mousemove.
  // That is cleaner than modifying the zoom handler.

  // RE-UPDATE mousemove to use d3.zoomTransform 
  svg.on("mousemove", (event) => {
    rulerGroup.style("display", null);

    // Get current transform directly from DOM
    const t = d3.zoomTransform(svg.node());

    const [mouseX, mouseY] = d3.pointer(event);

    // Update Line Position
    rulerLine
      .attr("y1", mouseY)
      .attr("y2", mouseY);

    // Calculate Value
    const newYScale = t.rescaleY(yScale);
    const value = newYScale.invert(mouseY);

    // Format Value
    const exp = value.toExponential(2);
    const [mantissa, exponent] = exp.split('e');
    // Remove '+' sign from exponent if present (parseInt does this, but to be clean)
    const expVal = parseInt(exponent, 10);
    const formattedValue = `${mantissa} × 10^${expVal} m`;

    // Update Label
    rulerLabel
      .attr("x", 10)
      .attr("y", mouseY - 10)
      .text(formattedValue);

    // Update Label Background
    const bbox = rulerLabel.node().getBBox();
    rulerLabelBackground
      .attr("x", bbox.x - 4)
      .attr("y", bbox.y - 4)
      .attr("width", bbox.width + 8)
      .attr("height", bbox.height + 8);
  });

});
