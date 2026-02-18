export const LANGUAGE = "en-us";

export const paddingLeft = 80;
export const fadeEnd = 160;
export const fadeBottomHeight = 85;
export const DOUBLE_CLICK_THRESHOLD = 300; // ms
export const paddingBottom = 35;


export const DEBUG_SHOW_BOUNDS = false; // Toggle debug bounding box


export const categories = {
    "Atoms / Elements": { color: "#00FFFF", displayName: { "en-us": "Atoms / Elements" } },
    "Astronomy": { color: "#FFD700", displayName: { "en-us": "Astronomy" } },
    "Biology": { color: "#7CFC00", displayName: { "en-us": "Biology" } },
    "Electromagnetic": { color: "#1E90FF", displayName: { "en-us": "Electromagnetic" } },
    "Fundamental / Nuclear": { color: "#FF00FF", displayName: { "en-us": "Fundamental / Nuclear" } },
    "Geology": { color: "#CD853F", displayName: { "en-us": "Geology" } },
    "Molecules": { color: "#ff0000ff", displayName: { "en-us": "Molecules" } },
    "Spacing": { color: "#FF8C00", displayName: { "en-us": "Spacing" } },
    "Sound": { color: "#FF69B4", displayName: { "en-us": "Sound" } },
    "Technology": { color: "#C0C0C0", displayName: { "en-us": "Technology" } },
    "Waves": { color: "#9370DB", displayName: { "en-us": "Waves" } },
};

export const FADE_OPACITY = 0.2;

export const INEQUALITY_ARROW_LENGTH_FACTOR = 4;

export const ZOOM_NEIGHBOR_DISTANCE_PX = 30; // Screen pixels to nearest neighbor when zooming to a point

// SYNC: Keep in sync with the @media query in style.css (search "Mobile Layout")
export const MOBILE_QUERY = '(max-width: 512px), (max-height: 512px)';
export function checkMobile() {
    return window.matchMedia(MOBILE_QUERY).matches;
}

export function checkTouch() {
    return window.matchMedia('(pointer: coarse)').matches;
}
