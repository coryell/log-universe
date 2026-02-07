import * as d3 from 'd3';
import './style.css';
import { getMatches, getHighlightedText } from './search.js';

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
  // Add padding to sides (e.g. -2 to +2 relative to data)
  const xScale = d3.scaleLinear()
    .domain([Math.min(0, minX - 2), maxX + 2])
    .range([220, width - 220]);

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
        return Number.isInteger(log10) ? 0.4 : 0.15;
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
    "Astronomy", "Biology", "Density", "Electromagnetic", "Fundamental",
    "Geology", "Nuclear / Atomic / Molecular", "Sound", "Technology", "Waves"
  ];
  const colors = [
    "#FFD700", "#7CFC00", "#FF8C00", "#1E90FF", "#FF00FF",
    "#CD853F", "#00FFFF", "#FF69B4", "#C0C0C0", "#9370DB"
  ];
  const colorScale = d3.scaleOrdinal().domain(categories).range(colors);

  // Initial draw with identity transform
  updateGrid(d3.zoomIdentity);

  // Calculate initial font size based on axes (height of one decade)
  const initialDecadeHeight = Math.abs(yScale(10) - yScale(1));
  const initialFS = Math.min(12, initialDecadeHeight);

  // Draw Points (radius proportional to font size)
  const initialRadius = initialFS / 2.4;
  g.selectAll('circle')
    .data(data)
    .join('circle')
    .attr('cx', d => xScale(d.x))
    .attr('cy', d => yScale(d.length))
    .attr('r', initialRadius)
    .attr('fill', d => colorScale(d.category));

  // Draw Labels
  g.selectAll('text.label')
    .data(data)
    .join('text')
    .attr('x', d => xScale(d.x) + 10)
    .attr('y', d => yScale(d.length))
    .attr('dy', '.35em')
    .text(d => d.displayName)
    .attr('class', 'label')
    .attr('fill', d => colorScale(d.category))
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

      // Update Points Position and Size
      const currentRadius = currentFS / 2.4;
      g.selectAll('circle')
        .attr('cx', d => newXScale(d.x))
        .attr('cy', d => newYScale(d.length))
        .attr('r', currentRadius);

      // Update Labels Position and Size
      g.selectAll('text.label')
        .attr('x', d => newXScale(d.x) + 10)
        .attr('y', d => newYScale(d.length))
        .attr('dy', '.35em')
        .style('font-size', `${currentFS}px`);
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
        // Dim all points and labels that don't match the category
        g.selectAll("circle")
          .transition().duration(200)
          .attr("opacity", d => d.category === cat ? 1 : 0.2);

        g.selectAll("text.label")
          .transition().duration(200)
          .attr("opacity", d => d.category === cat ? 1 : 0.2);
        // Bring matching points and labels to the front
        g.selectAll("circle").filter(d => d.category === cat).raise();
        g.selectAll("text.label").filter(d => d.category === cat).raise();
      })
      .on("mouseout", function () {
        // Restore opacity
        g.selectAll("circle")
          .transition().duration(200)
          .attr("opacity", 1);

        g.selectAll("text.label")
          .transition().duration(200)
          .attr("opacity", 1);

        // Restore original order (assuming data index)
        g.selectAll("circle").sort((a, b) => d3.ascending(a.id, b.id)); // Or just standard sort if data order matters
        g.selectAll("text.label").sort((a, b) => d3.ascending(a.id, b.id));
      })
      .on("click", function (event, d) {
        // Filter data for this category
        const categoryData = data.filter(item => item.category === cat);
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
        const padding = 50;
        const labelAllowance = 200; // Estimate for label width on the right

        minX -= padding;
        maxX += labelAllowance;
        minY -= padding;
        maxY += padding;

        const boundsWidth = maxX - minX;
        const boundsHeight = maxY - minY;

        // Calculate scale and translation to fit
        // Scale must fit both width and height
        const scale = 0.9 / Math.max(boundsWidth / width, boundsHeight / height);

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

      div.innerHTML = getHighlightedText(d.displayName, query);

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

  // Select Result & Zoom
  function selectResult(d) {
    searchInput.value = d.displayName;
    searchResults.style.display = 'none';

    // Zoom to point logic
    // We want to center (d.x, d.length)
    // Calculate scale to show roughly 3 decades vertically
    const domain = yScale.domain();
    const totalDecades = Math.log10(domain[1]) - Math.log10(domain[0]);
    const availableHeight = height - 100; // From yScale range [height - 50, 50]

    // We want 3 decades to fill the screen height
    // k = (height * totalDecades) / (3 * availableHeight)
    let scale = (height * totalDecades) / (3 * availableHeight);

    // Clamp scale reasonably
    scale = Math.max(1, Math.min(scale, 1000));
    const x = xScale(d.x);
    const y = yScale(d.length);

    const transform = d3.zoomIdentity
      .translate(width / 2, height / 2) // Center of screen
      .scale(scale)
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
    const matches = getMatches(data, query);
    renderResults(matches, query);
  });

  searchInput.addEventListener('focus', () => {
    const query = searchInput.value;
    if (query) {
      const matches = getMatches(data, query);
      renderResults(matches, query);
    }
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
        const matches = getMatches(data, query);
        if (matches[selectedIndex]) {
          selectResult(matches[selectedIndex]);
        }
      } else if (items.length > 0) {
        // Default to first item if none selected
        const query = searchInput.value;
        const matches = getMatches(data, query);
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

});
