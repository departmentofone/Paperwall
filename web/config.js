/*
 * Paperwall customisation file.
 * Edit the values, save, then use "Reload wallpaper" in the tray menu (or refresh the page).
 * Units: the screen is always 1000 units tall.
 */
window.PAPERWALL_CONFIG = {

  // ---- Motion ---------------------------------------------------------------
  baseSpeed: 21,        // scroll speed of the nearest layer, in units/second, at Speed = 1
                        // (the tray menu's Speed multiplies this). 14 was the original pace.
  pixelSnap: false,     // false = smooth sub-pixel motion (recommended)
                        // true  = crisp whole-pixel steps (sharper, but steps visibly at low speed)

  // ---- Scene density (1 = default, 0 = none, 2 = twice as often) ---------------
  density: {
    mountains: 1,       // big mountains in the main layer
    villages: 1,        // villages, hamlets and houses
    towers: 1,          // pagodas, pavilions and temples
    rivers: 1,          // streams winding through the land (with bridges)
    trees: 1,           // trees and forest groves
    boats: 1,           // fishing boats and sails
  },

  // ---- Default settings ----------------------------------------------------------
  // Used by the browser / Lively / Wallpaper Engine versions. The Windows app keeps its own
  // settings in %APPDATA%\Paperwall\settings.ini (changed from the tray menu or the Paperwall window).
  defaults: {
    theme: 'yugen',     // 'shanshui', 'yugen', 'jiangnan' or 'tabiji'
    fps: 30,            // frame-rate cap. 30 is smooth for this pace; 60 for high-refresh fans
    // speed: 1, time: 'auto', season: 'auto', weather: 'auto', style: 'sumi', ...
  },

};
