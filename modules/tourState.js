import * as d3 from 'd3';
import { getLocalized } from './utils.js';
import { LANGUAGE } from './constants.js';

export function createTourState({ viz, viewState }) {
    let isActive = false;
    let tourTimeoutId = null;
    let driftAnimId = null;

    // Current drift velocity in data space (persists across stops for crossfade)
    let activeDriftDx = 0;
    let activeDriftDy = 0;

    // Round-robin state for category and point selection
    let categoryQueue = [];
    let pointQueues = new Map();

    // Timing constants
    const ZOOM_DURATION = 4000;
    const DWELL_TIME = 10000;
    const DRIFT_SCREEN_PX_PER_SEC = 10;

    function getTourBtn() {
        return document.getElementById('tour-btn');
    }

    /** Fisher-Yates shuffle (in place) */
    function shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    /**
     * Build a map of category -> visible points from the current filtered data.
     */
    function buildCategoryMap() {
        const currentData = viz.currentState.filteredData;
        if (!currentData || currentData.length === 0) return new Map();

        const map = new Map();
        for (const item of currentData) {
            const cat = getLocalized(item.category, LANGUAGE);
            if (!map.has(cat)) map.set(cat, []);
            map.get(cat).push(item);
        }
        return map;
    }

    /**
     * Get the next tour item using round-robin categories without replacement.
     */
    function getNextItem() {
        const catMap = buildCategoryMap();
        if (catMap.size === 0) return null;

        if (categoryQueue.length === 0) {
            categoryQueue = shuffle([...catMap.keys()]);
        }

        let attempts = categoryQueue.length;
        while (attempts > 0) {
            const cat = categoryQueue.shift();
            attempts--;

            const visiblePoints = catMap.get(cat);
            if (!visiblePoints || visiblePoints.length === 0) continue;

            if (!pointQueues.has(cat) || pointQueues.get(cat).length === 0) {
                pointQueues.set(cat, shuffle([...visiblePoints]));
            }

            const queue = pointQueues.get(cat);
            while (queue.length > 0) {
                const candidate = queue.shift();
                if (visiblePoints.some(p => p.id === candidate.id)) {
                    return candidate;
                }
            }

            pointQueues.set(cat, shuffle([...visiblePoints]));
            const retryQueue = pointQueues.get(cat);
            if (retryQueue.length > 0) {
                return retryQueue.shift();
            }
        }

        return null;
    }

    function stopDrift() {
        if (driftAnimId) {
            cancelAnimationFrame(driftAnimId);
            driftAnimId = null;
        }
        activeDriftDx = 0;
        activeDriftDy = 0;
    }

    /**
     * Convert a d3 zoom transform to the [cx, cy, w] view format
     * used by d3.interpolateZoom.
     */
    function transformToView(t, vpW, vpH) {
        return [
            (vpW / 2 - t.x) / t.k,
            (vpH / 2 - t.y) / t.k,
            vpW / t.k
        ];
    }

    /**
     * Convert a [cx, cy, w] view back to a d3 zoom transform.
     */
    function viewToTransform(view, vpW, vpH) {
        const [cx, cy, w] = view;
        const k = vpW / w;
        return d3.zoomIdentity
            .translate(vpW / 2 - cx * k, vpH / 2 - cy * k)
            .scale(k);
    }

    /**
     * Start constant-velocity drift in data space.
     */
    function startDrift(dataDx, dataDy) {
        if (driftAnimId) {
            cancelAnimationFrame(driftAnimId);
            driftAnimId = null;
        }
        activeDriftDx = dataDx;
        activeDriftDy = dataDy;

        let lastTime = performance.now();

        function driftFrame(now) {
            if (!isActive) { stopDrift(); return; }

            const dt = (now - lastTime) / 1000;
            lastTime = now;

            if (dt > 0 && dt < 0.1) {
                const currentT = viz.getTransform();
                const newT = d3.zoomIdentity
                    .translate(currentT.x - dataDx * currentT.k * dt, currentT.y - dataDy * currentT.k * dt)
                    .scale(currentT.k);
                viz.zoomTo(newT, 0);
            }

            driftAnimId = requestAnimationFrame(driftFrame);
        }

        driftAnimId = requestAnimationFrame(driftFrame);
    }

    /**
     * Animate zoom to an item using our own rAF loop with d3.interpolateZoom
     * for the flyover, plus an additive drift that crossfades from the
     * previous drift direction to the new one during the zoom.
     *
     * At t=0: drift is 100% old direction (continuous with previous stop).
     * At t=1: drift is 100% new direction at full speed.
     */
    function zoomWithDrift(nextItem, onZoomEnd) {
        const { width: vpW, height: vpH } = viz.getScales();

        // Capture the outgoing drift velocity before stopping it
        const oldDriftDx = activeDriftDx;
        const oldDriftDy = activeDriftDy;

        // Stop the previous drift rAF (but don't zero activeDrift — we just captured it)
        if (driftAnimId) {
            cancelAnimationFrame(driftAnimId);
            driftAnimId = null;
        }

        // Get current transform and start the D3 zoom to compute target
        const startT = viz.getTransform();
        const targetT = viz.zoomToItem(nextItem, false, ZOOM_DURATION);

        // Immediately interrupt D3's transition — we'll drive the animation ourselves
        viz.interruptZoom();

        if (!targetT) {
            if (onZoomEnd) onZoomEnd();
            return;
        }

        // Convert transforms to [cx, cy, w] views for d3.interpolateZoom
        const startView = transformToView(startT, vpW, vpH);
        const targetView = transformToView(targetT, vpW, vpH);

        // Create the Gustafson smooth zoom interpolator (same as D3 uses internally)
        const zoomInterpolator = d3.interpolateZoom(startView, targetView);

        // Compute NEW drift direction in data space (start center → target center)
        const dirDx = targetView[0] - startView[0];
        const dirDy = targetView[1] - startView[1];
        const dirDist = Math.sqrt(dirDx * dirDx + dirDy * dirDy);

        // New drift velocity in data space at the TARGET zoom level
        const targetK = vpW / targetView[2];
        const driftDataSpeed = DRIFT_SCREEN_PX_PER_SEC / targetK;
        const newDriftDx = dirDist > 0 ? (dirDx / dirDist) * driftDataSpeed : 0;
        const newDriftDy = dirDist > 0 ? (dirDy / dirDist) * driftDataSpeed : 0;

        // Accumulated drift offset in data space
        let accDriftX = 0;
        let accDriftY = 0;

        const animStart = performance.now();
        let lastTime = animStart;

        function frame(now) {
            if (!isActive) { stopDrift(); return; }

            const elapsed = now - animStart;
            const dt = (now - lastTime) / 1000;
            lastTime = now;

            // Normalized time [0, 1] for the zoom
            const rawT = Math.min(elapsed / ZOOM_DURATION, 1);

            // D3's default cubic-in-out easing
            const eased = rawT < 0.5
                ? 4 * rawT * rawT * rawT
                : 1 - Math.pow(-2 * rawT + 2, 3) / 2;

            // Get the interpolated view at this easing progress
            const currentView = zoomInterpolator(eased);
            const zoomT = viewToTransform(currentView, vpW, vpH);

            // Crossfade drift: old drift eases out, new drift eases in
            // At t=0: fully old drift. At t=1: fully new drift.
            const blendIn = rawT * rawT;       // ease-in for new drift
            const blendOut = 1 - blendIn;       // ease-out for old drift

            const blendedDx = oldDriftDx * blendOut + newDriftDx * blendIn;
            const blendedDy = oldDriftDy * blendOut + newDriftDy * blendIn;

            if (dt > 0 && dt < 0.1) {
                accDriftX += blendedDx * dt;
                accDriftY += blendedDy * dt;
            }

            // Combine: zoom transform + drift offset (in data space → screen space shift)
            const k = zoomT.k;
            const finalT = d3.zoomIdentity
                .translate(zoomT.x - accDriftX * k, zoomT.y - accDriftY * k)
                .scale(k);

            viz.zoomTo(finalT, 0);

            if (rawT < 1) {
                driftAnimId = requestAnimationFrame(frame);
            } else {
                // Zoom complete. Drift is already at full speed in new direction.
                startDrift(newDriftDx, newDriftDy);
                if (onZoomEnd) onZoomEnd();
            }
        }

        driftAnimId = requestAnimationFrame(frame);
    }

    function scheduleNextTourStop() {
        if (!isActive) return;

        const nextItem = getNextItem();
        if (!nextItem) {
            stopTour();
            return;
        }

        zoomWithDrift(nextItem, () => {
            if (!isActive) return;

            viewState.showInfobox(nextItem);

            tourTimeoutId = setTimeout(() => {
                if (!isActive) return;
                viewState.hideInfobox();
                scheduleNextTourStop();
            }, DWELL_TIME);
        });
    }

    function startTour() {
        if (isActive) return;
        isActive = true;

        categoryQueue = [];
        pointQueues = new Map();

        const btn = getTourBtn();
        if (btn) {
            btn.classList.add('active');
            btn.textContent = 'Stop Tour';
        }

        viewState.hideInfobox();
        scheduleNextTourStop();
    }

    function stopTour() {
        if (!isActive) return;
        isActive = false;

        stopDrift();

        if (tourTimeoutId) {
            clearTimeout(tourTimeoutId);
            tourTimeoutId = null;
        }

        const btn = getTourBtn();
        if (btn) {
            btn.classList.remove('active');
            btn.textContent = 'Tour';
        }
    }

    function toggleTour() {
        if (isActive) {
            stopTour();
        } else {
            startTour();
        }
    }

    const state = {
        get isActive() { return isActive; },
        startTour,
        stopTour,
        toggleTour
    };

    setTimeout(() => {
        const btn = getTourBtn();
        if (btn) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleTour();
            });
        }
    }, 0);

    return state;
}
