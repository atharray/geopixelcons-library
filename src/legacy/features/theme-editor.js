
    // ============================================================
    //  FEATURE: Theme Editor [themeEditor]
    // ============================================================
    if (_settings.themeEditor) {
        try {
            (function _init_themeEditor() {

    // ─── Constants ───────────────────────────────────────────────────
    const TE_STORAGE_KEY = 'geoThemeEditor_themes';
    const TE_ACTIVE_KEY = 'geoThemeEditor_active';
    const TE_BASE_URL = 'https://geopixels.net';
    const TE_MINOR_ROAD_KEY = 'geoThemeEditor_minorRoadsHidden_v1';
    const TE_FEEDBACK_KEY = 'geoThemeEditor_themeFeedback_v2';

    const HIDE_MINOR_ROAD_KEYS = {
        dark: ['highway_path::line-color','highway_minor::line-color','highway_name_other::text-color','highway_name_other::text-halo-color'],
        light: ['road_path_pedestrian::line-color','road_minor::line-color','highway-name-minor::text-color']
    };

    const BUNDLED_THEMES = {"default_light":{"base":"light","name":"Default","overrides":{}},"default_dark":{"base":"dark","name":"Default Dark","overrides":{}},"fjord":{"base":"dark","name":"Fjord","overrides":{"background::background-color":"#45516E","water::fill-color":"#38435C","waterway::line-color":"#2f3436","water_name::text-color":"#90a3b7","water_name::text-halo-color":"#45516E","landcover_ice_shelf::fill-color":"#2f3647","landcover_glacier::fill-color":"#2f3647","landcover_wood::fill-color":"#3a3d46","landuse_park::fill-color":"#394854","landuse_residential::fill-color":"#3a3e47","building::fill-color":"#1c232f","building::fill-outline-color":"#2d3440","aeroway-area::fill-color":"#374455","aeroway-taxiway::line-color":"#527386","road_area_pier::fill-color":"#45516E","road_pier::line-color":"#45516E","highway_path::line-color":"#485866","highway_minor::line-color":"#6b7f8f","highway_major_inner::line-color":"#8fa0b0","highway_major_casing::line-color":"#5a6b7d","highway_major_subtle::line-color":"#4a5b6d","highway_motorway_inner::line-color":"#a0b0c0","highway_motorway_casing::line-color":"#6a7b8d","highway_motorway_subtle::line-color":"#5a6b7d","railway::line-color":"#5a6b7d","railway_dashline::line-color":"#3a4b5d","railway_transit::line-color":"#5a6b7d","railway_transit_dashline::line-color":"#3a4b5d","boundary_state::line-color":"#7a8b9d","boundary_country_z0-4::line-color":"#8a9baf","boundary_country_z5-::line-color":"#8a9baf","highway_name_other::text-color":"#b0c0d0","highway_name_other::text-halo-color":"#1a2a3a","highway_name_motorway::text-color":"#c0d0e0","place_other::text-color":"#a0b0c0","place_other::text-halo-color":"#1a2a3a","place_village::text-color":"#a0b0c0","place_village::text-halo-color":"#1a2a3a","place_town::text-color":"#b0c0d0","place_town::text-halo-color":"#1a2a3a","place_city::text-color":"#c0d0e0","place_city::text-halo-color":"#1a2a3a","place_city_large::text-color":"#d0e0f0","place_city_large::text-halo-color":"#1a2a3a","place_state::text-color":"#a0b0c0","place_state::text-halo-color":"#1a2a3a","place_country_major::text-color":"#c0d0e0","place_country_major::text-halo-color":"#1a2a3a","place_country_minor::text-color":"#a0b0c0","place_country_minor::text-halo-color":"#1a2a3a","place_country_other::text-color":"#909fa0","place_country_other::text-halo-color":"#1a2a3a"}},"debug_black":{"base":"dark","name":"Debug Black","overrides":{"background::background-color":"#000000","water::fill-color":"#000000","waterway::line-color":"#000000","water_name::text-color":"#000000","water_name::text-halo-color":"#000000","landcover_ice_shelf::fill-color":"#000000","landcover_glacier::fill-color":"#000000","landcover_wood::fill-color":"#000000","landuse_park::fill-color":"#000000","landuse_residential::fill-color":"#000000","building::fill-color":"#000000","building::fill-outline-color":"#000000","aeroway-area::fill-color":"#000000","aeroway-taxiway::line-color":"#000000","road_area_pier::fill-color":"#000000","road_pier::line-color":"#000000","highway_path::line-color":"#000000","highway_minor::line-color":"#000000","highway_major_inner::line-color":"#000000","highway_major_casing::line-color":"#000000","highway_major_subtle::line-color":"#000000","highway_motorway_inner::line-color":"#000000","highway_motorway_casing::line-color":"#000000","highway_motorway_subtle::line-color":"#000000","railway::line-color":"#000000","railway_dashline::line-color":"#000000","railway_transit::line-color":"#000000","railway_transit_dashline::line-color":"#000000","boundary_state::line-color":"#000000","boundary_country_z0-4::line-color":"#000000","boundary_country_z5-::line-color":"#000000","highway_name_other::text-color":"#000000","highway_name_other::text-halo-color":"#000000","highway_name_motorway::text-color":"#000000","place_other::text-color":"#000000","place_other::text-halo-color":"#000000","place_village::text-color":"#000000","place_village::text-halo-color":"#000000","place_town::text-color":"#000000","place_town::text-halo-color":"#000000","place_city::text-color":"#000000","place_city::text-halo-color":"#000000","place_city_large::text-color":"#000000","place_city_large::text-halo-color":"#000000","place_state::text-color":"#000000","place_state::text-halo-color":"#000000","place_country_major::text-color":"#000000","place_country_major::text-halo-color":"#000000","place_country_minor::text-color":"#000000","place_country_minor::text-halo-color":"#000000","place_country_other::text-color":"#000000","place_country_other::text-halo-color":"#000000"}},"debug_white":{"base":"light","name":"Debug White","overrides":{"background::background-color":"#ffffff","water::fill-color":"#ffffff","waterway_river::line-color":"#ffffff","waterway_other::line-color":"#ffffff","water_name_point_label::text-color":"#ffffff","water_name_point_label::text-halo-color":"#ffffff","water_name_line_label::text-color":"#ffffff","water_name_line_label::text-halo-color":"#ffffff","landcover_ice::fill-color":"#ffffff","landcover_wood::fill-color":"#ffffff","park::fill-color":"#ffffff","landuse_residential::fill-color":"#ffffff","building::fill-color":"#ffffff","aeroway_fill::fill-color":"#ffffff","road_path_pedestrian::line-color":"#ffffff","road_minor::line-color":"#ffffff","road_secondary_tertiary::line-color":"#ffffff","road_trunk_primary::line-color":"#ffffff","road_trunk_primary_casing::line-color":"#ffffff","road_motorway::line-color":"#ffffff","road_motorway_casing::line-color":"#ffffff","road_motorway_link::line-color":"#ffffff","road_major_rail::line-color":"#ffffff","road_major_rail_hatching::line-color":"#ffffff","road_transit_rail::line-color":"#ffffff","road_transit_rail_hatching::line-color":"#ffffff","boundary_3::line-color":"#ffffff","boundary_2::line-color":"#ffffff","boundary_disputed::line-color":"#ffffff","highway-name-minor::text-color":"#ffffff","highway-name-major::text-color":"#ffffff","label_other::text-color":"#ffffff","label_other::text-halo-color":"#ffffff","label_village::text-color":"#ffffff","label_village::text-halo-color":"#ffffff","label_town::text-color":"#ffffff","label_town::text-halo-color":"#ffffff","label_city::text-color":"#ffffff","label_city::text-halo-color":"#ffffff","label_city_capital::text-color":"#ffffff","label_city_capital::text-halo-color":"#ffffff","label_state::text-color":"#ffffff","label_state::text-halo-color":"#ffffff","label_country_1::text-color":"#ffffff","label_country_1::text-halo-color":"#ffffff","label_country_2::text-color":"#ffffff","label_country_2::text-halo-color":"#ffffff","label_country_3::text-color":"#ffffff","label_country_3::text-halo-color":"#ffffff"}},"ayu_mirage":{"base":"light","name":"Ayu Mirage","overrides":{"background::background-color":"#f3f4f6","park::fill-color":"#e6eec8","landuse_residential::fill-color":"hsla(35,57%,88%,0.49)","landcover_wood::fill-color":"#e6eec8","landcover_ice::fill-color":"rgba(224, 236, 236, 1)","waterway_river::line-color":"#dbe6f0","waterway_other::line-color":"#dbe6f0","water::fill-color":"#dbe6f0","building::fill-color":"#e6e1cf","building::fill-outline-color":"#f3f4f6","road_path_pedestrian::line-color":"#cfccc6","road_minor::line-color":"#cfccc6","road_secondary_tertiary::line-color":"#cfccc6","road_trunk_primary::line-color":"#ffae57","road_trunk_primary_casing::line-color":"#ffae57","road_motorway::line-color":"#ffae57","road_motorway_casing::line-color":"#ffae57","road_motorway_link::line-color":"#ffae57","road_major_rail::line-color":"#ffae57","road_major_rail_hatching::line-color":"#ffae57","road_transit_rail::line-color":"#cfccc6","road_transit_rail_hatching::line-color":"#cfccc6","boundary_3::line-color":"#5c6773","boundary_2::line-color":"#5c6773","boundary_disputed::line-color":"#5c6773","highway-name-minor::text-color":"#5c6773","highway-name-major::text-color":"#5c6773","label_other::text-color":"#5c6773","label_other::text-halo-color":"#f3f4f6","label_village::text-color":"#5c6773","label_village::text-halo-color":"#f3f4f6","label_town::text-color":"#5c6773","label_town::text-halo-color":"#f3f4f6","label_city::text-color":"#5c6773","label_city::text-halo-color":"#f3f4f6","label_city_capital::text-color":"#5c6773","label_city_capital::text-halo-color":"#f3f4f6","label_state::text-color":"#5c6773","label_state::text-halo-color":"#f3f4f6","label_country_1::text-color":"#5c6773","label_country_1::text-halo-color":"#f3f4f6","label_country_2::text-color":"#5c6773","label_country_2::text-halo-color":"#f3f4f6","label_country_3::text-color":"#5c6773","label_country_3::text-halo-color":"#f3f4f6"}},"cute_pink":{"base":"light","name":"Cute & Pink","overrides":{"background::background-color":"#fff0f5","park::fill-color":"#ffe6f2","landcover_wood::fill-color":"#ffe6f2","waterway_river::line-color":"#cceeff","waterway_other::line-color":"#cceeff","water::fill-color":"#cceeff","road_path_pedestrian::line-color":"#ffb3d9","road_minor::line-color":"#ffb3d9","road_secondary_tertiary::line-color":"#ffb3d9","road_trunk_primary::line-color":"#ffb3d9","road_trunk_primary_casing::line-color":"#ffb3d9","road_motorway::line-color":"#ffb3d9","road_motorway_casing::line-color":"#ffb3d9","road_motorway_link::line-color":"#ffb3d9","road_major_rail::line-color":"#ffb3d9","road_transit_rail::line-color":"#ffb3d9","building::fill-color":"#ffdaeb","building::fill-outline-color":"#fff0f5","boundary_3::line-color":"#993366","boundary_2::line-color":"#993366","boundary_disputed::line-color":"#993366","highway-name-minor::text-color":"#993366","highway-name-major::text-color":"#993366","label_other::text-color":"#993366","label_other::text-halo-color":"#fff0f5","label_village::text-color":"#993366","label_village::text-halo-color":"#fff0f5","label_town::text-color":"#993366","label_town::text-halo-color":"#fff0f5","label_city::text-color":"#993366","label_city::text-halo-color":"#fff0f5","label_city_capital::text-color":"#993366","label_city_capital::text-halo-color":"#fff0f5","label_state::text-color":"#993366","label_state::text-halo-color":"#fff0f5","label_country_1::text-color":"#993366","label_country_1::text-halo-color":"#fff0f5","label_country_2::text-color":"#993366","label_country_2::text-halo-color":"#fff0f5","label_country_3::text-color":"#993366","label_country_3::text-halo-color":"#fff0f5"}},"discord_gold":{"base":"dark","name":"Discord Gold","overrides":{"background::background-color":"#171717","water::fill-color":"#23272A","waterway::line-color":"hsl(232, 23%, 28%)","water_name::text-color":"hsl(38, 60%, 50%)","water_name::text-halo-color":"hsl(232, 5%, 19%)","landcover_ice_shelf::fill-color":"hsl(232, 33%, 34%)","landuse_residential::fill-color":"transparent","landcover_wood::fill-color":"hsla(232, 18%, 30%, 0.57)","landuse_park::fill-color":"hsl(204, 17%, 35%)","building::fill-color":"hsla(232, 47%, 18%, 0.65)","highway_path::line-color":"hsl(211, 29%, 38%)","highway_minor::line-color":"hsl(224, 22%, 45%)","highway_major_casing::line-color":"hsl(224, 22%, 45%)","highway_major_inner::line-color":"#36393F","highway_major_subtle::line-color":"#38393E","highway_motorway_casing::line-color":"hsl(224, 22%, 45%)","highway_motorway_inner::line-color":"hsl(224, 20%, 29%)","highway_motorway_subtle::line-color":"hsla(239, 45%, 69%, 0.2)","railway::line-color":"hsl(200, 10%, 18%)","railway_dashline::line-color":"hsl(224, 20%, 41%)","boundary_state::line-color":"hsla(195, 47%, 62%, 0.26)","boundary_country_z0-4::line-color":"hsl(214, 63%, 76%)","boundary_country_z5-::line-color":"hsl(214, 63%, 76%)","highway_name_other::text-color":"hsl(38, 70%, 60%)","highway_name_other::text-halo-color":"hsl(232, 9%, 23%)","highway_name_motorway::text-color":"hsl(38, 70%, 60%)","place_other::text-color":"hsl(38, 65%, 60%)","place_other::text-halo-color":"hsla(228, 60%, 21%, 0.7)","place_village::text-color":"hsl(38, 70%, 45%)","place_village::text-halo-color":"hsla(228, 60%, 21%, 0.7)","place_town::text-color":"hsl(38, 75%, 65%)","place_town::text-halo-color":"hsla(228, 60%, 21%, 0.7)","place_city::text-color":"hsl(38, 75%, 65%)","place_city::text-halo-color":"hsla(228, 60%, 21%, 0.7)","place_city_large::text-color":"hsl(38, 75%, 65%)","place_city_large::text-halo-color":"hsla(228, 60%, 21%, 0.7)","place_state::text-color":"rgb(113, 129, 144)","place_state::text-halo-color":"hsla(228, 60%, 21%, 0.7)","place_country_other::text-color":"rgb(153, 153, 153)","place_country_other::text-halo-color":"hsla(228, 60%, 21%, 0.7)","place_country_minor::text-color":"rgb(153, 153, 153)","place_country_minor::text-halo-color":"hsla(228, 60%, 21%, 0.7)","place_country_major::text-color":"rgb(153, 153, 153)","place_country_major::text-halo-color":"hsla(228, 60%, 21%, 0.7)"}},"monokai":{"base":"dark","name":"Monokai","overrides":{"background::background-color":"#000000","water::fill-color":"#2D2E28","waterway::line-color":"hsl(232, 23%, 28%)","water_name::text-color":"hsl(223, 21%, 52%)","water_name::text-halo-color":"hsl(232, 5%, 19%)","landcover_ice_shelf::fill-color":"hsl(70, 15%, 35%)","landuse_residential::fill-color":"transparent","landcover_wood::fill-color":"hsla(232, 18%, 30%, 0.57)","landuse_park::fill-color":"hsl(204, 17%, 35%)","building::fill-color":"hsla(232, 47%, 18%, 0.65)","highway_path::line-color":"hsl(211, 29%, 38%)","highway_minor::line-color":"hsl(70, 20%, 40%)","highway_major_casing::line-color":"hsl(70, 20%, 40%)","highway_major_inner::line-color":"#3A3E38","highway_major_subtle::line-color":"#273a2d","highway_motorway_casing::line-color":"hsl(70, 20%, 40%)","highway_motorway_inner::line-color":"hsl(70, 18%, 28%)","highway_motorway_subtle::line-color":"hsla(239, 45%, 69%, 0.2)","railway::line-color":"hsl(40, 20%, 18%)","railway_dashline::line-color":"hsl(224, 20%, 41%)","boundary_state::line-color":"hsla(195, 47%, 62%, 0.26)","boundary_country_z0-4::line-color":"hsl(214, 63%, 76%)","boundary_country_z5-::line-color":"hsl(214, 63%, 76%)","highway_name_other::text-color":"hsl(223, 31%, 61%)","highway_name_other::text-halo-color":"hsl(232, 9%, 23%)","place_other::text-color":"hsl(195, 37%, 73%)","place_other::text-halo-color":"hsla(228, 60%, 21%, 0.7)","place_village::text-color":"hsl(195, 41%, 49%)","place_village::text-halo-color":"hsla(228, 60%, 21%, 0.7)","place_town::text-color":"hsl(195, 25%, 76%)","place_town::text-halo-color":"hsla(228, 60%, 21%, 0.7)","place_city::text-color":"hsl(195, 25%, 76%)","place_city::text-halo-color":"hsla(228, 60%, 21%, 0.7)","place_city_large::text-color":"hsl(195, 25%, 76%)","place_city_large::text-halo-color":"hsla(228, 60%, 21%, 0.7)","place_state::text-color":"rgb(140, 130, 100)","place_state::text-halo-color":"hsla(228, 60%, 21%, 0.7)","place_country_other::text-color":"rgb(153, 153, 153)","place_country_other::text-halo-color":"hsla(228, 60%, 21%, 0.7)","place_country_minor::text-color":"rgb(153, 153, 153)","place_country_minor::text-halo-color":"hsla(228, 60%, 21%, 0.7)","place_country_major::text-color":"rgb(153, 153, 153)","place_country_major::text-halo-color":"hsla(228, 60%, 21%, 0.7)"}},"obsidian":{"base":"dark","name":"Obsidian","overrides":{"background::background-color":"#1c1c1c","water::fill-color":"#262626","waterway::line-color":"#262626","water_name::text-color":"#a0a0a0","water_name::text-halo-color":"#1c1c1c","landcover_ice_shelf::fill-color":"rgb(12,12,12)","landcover_glacier::fill-color":"hsl(0, 1%, 2%)","landuse_residential::fill-color":"hsl(0, 2%, 5%)","landcover_wood::fill-color":"#2a2a2a","landuse_park::fill-color":"#2a2a2a","building::fill-color":"#242424","building::fill-outline-color":"#1c1c1c","highway_path::line-color":"#3d3d3d","highway_minor::line-color":"#3d3d3d","highway_major_casing::line-color":"#555555","highway_major_inner::line-color":"#555555","highway_major_subtle::line-color":"#555555","highway_motorway_casing::line-color":"#555555","highway_motorway_inner::line-color":"#555555","highway_motorway_subtle::line-color":"#555555","railway::line-color":"rgb(35,35,35)","railway_dashline::line-color":"rgb(12,12,12)","boundary_state::line-color":"#a0a0a0","boundary_country_z0-4::line-color":"#a0a0a0","boundary_country_z5-::line-color":"#a0a0a0","highway_name_other::text-color":"#a0a0a0","highway_name_other::text-halo-color":"#1c1c1c","highway_name_motorway::text-color":"#a0a0a0","place_other::text-color":"#a0a0a0","place_other::text-halo-color":"#1c1c1c","place_village::text-color":"#a0a0a0","place_village::text-halo-color":"#1c1c1c","place_town::text-color":"#a0a0a0","place_town::text-halo-color":"#1c1c1c","place_city::text-color":"#a0a0a0","place_city::text-halo-color":"#1c1c1c","place_city_large::text-color":"#a0a0a0","place_city_large::text-halo-color":"#1c1c1c","place_state::text-color":"#a0a0a0","place_state::text-halo-color":"#1c1c1c","place_country_other::text-color":"#a0a0a0","place_country_other::text-halo-color":"#1c1c1c","place_country_minor::text-color":"#a0a0a0","place_country_minor::text-halo-color":"#1c1c1c","place_country_major::text-color":"#a0a0a0","place_country_major::text-halo-color":"#1c1c1c"}},"vintage_sepia":{"base":"light","name":"Vintage Sepia","overrides":{"background::background-color":"#f4e4bc","park::fill-color":"#c5d5a7","landcover_wood::fill-color":"#c5d5a7","waterway_river::line-color":"#d2c29d","waterway_other::line-color":"#d2c29d","water::fill-color":"#d2c29d","road_path_pedestrian::line-color":"#a89f91","road_minor::line-color":"#a89f91","road_secondary_tertiary::line-color":"#a89f91","road_trunk_primary::line-color":"#8f8170","road_trunk_primary_casing::line-color":"#8f8170","road_motorway::line-color":"#8f8170","road_motorway_casing::line-color":"#8f8170","road_motorway_link::line-color":"#8f8170","road_major_rail::line-color":"#8f8170","road_transit_rail::line-color":"#a89f91","building::fill-color":"#e8d5a8","building::fill-outline-color":"#f4e4bc","boundary_3::line-color":"#5b4a42","boundary_2::line-color":"#5b4a42","boundary_disputed::line-color":"#5b4a42","highway-name-minor::text-color":"#5b4a42","highway-name-major::text-color":"#5b4a42","label_other::text-color":"#5b4a42","label_other::text-halo-color":"#f4e4bc","label_village::text-color":"#5b4a42","label_village::text-halo-color":"#f4e4bc","label_town::text-color":"#5b4a42","label_town::text-halo-color":"#f4e4bc","label_city::text-color":"#5b4a42","label_city::text-halo-color":"#f4e4bc","label_city_capital::text-color":"#5b4a42","label_city_capital::text-halo-color":"#f4e4bc","label_state::text-color":"#5b4a42","label_state::text-halo-color":"#f4e4bc","label_country_1::text-color":"#5b4a42","label_country_1::text-halo-color":"#f4e4bc","label_country_2::text-color":"#5b4a42","label_country_2::text-halo-color":"#f4e4bc","label_country_3::text-color":"#5b4a42","label_country_3::text-halo-color":"#f4e4bc"}}};

    const EDITABLE_LAYERS = {
        dark: [
            { group: 'Base', layers: [{ id: 'background', prop: 'background-color', label: 'Background' }] },
            { group: 'Water', layers: [{ id: 'water', prop: 'fill-color', label: 'Water Fill' },{ id: 'waterway', prop: 'line-color', label: 'Waterways' },{ id: 'water_name', prop: 'text-color', label: 'Water Labels' },{ id: 'water_name', prop: 'text-halo-color', label: 'Water Label Halo' }] },
            { group: 'Land & Nature', layers: [{ id: 'landcover_ice_shelf', prop: 'fill-color', label: 'Ice Shelf' },{ id: 'landcover_glacier', prop: 'fill-color', label: 'Glaciers' },{ id: 'landcover_wood', prop: 'fill-color', label: 'Forests / Wood' },{ id: 'landuse_park', prop: 'fill-color', label: 'Parks' },{ id: 'landuse_residential', prop: 'fill-color', label: 'Residential' }] },
            { group: 'Buildings & Areas', layers: [{ id: 'building', prop: 'fill-color', label: 'Building Fill' },{ id: 'building', prop: 'fill-outline-color', label: 'Building Outline' },{ id: 'aeroway-area', prop: 'fill-color', label: 'Airport Area' },{ id: 'road_area_pier', prop: 'fill-color', label: 'Pier Area' }] },
            { group: 'Roads', layers: [{ id: 'highway_path', prop: 'line-color', label: 'Paths' },{ id: 'highway_minor', prop: 'line-color', label: 'Minor Roads' },{ id: 'highway_major_inner', prop: 'line-color', label: 'Major Roads' },{ id: 'highway_major_casing', prop: 'line-color', label: 'Major Road Casing' },{ id: 'highway_major_subtle', prop: 'line-color', label: 'Major Roads (Subtle)' },{ id: 'highway_motorway_inner', prop: 'line-color', label: 'Motorway' },{ id: 'highway_motorway_casing', prop: 'line-color', label: 'Motorway Casing' },{ id: 'highway_motorway_subtle', prop: 'line-color', label: 'Motorway (Subtle)' },{ id: 'road_pier', prop: 'line-color', label: 'Pier Roads' },{ kind: 'mult', label: 'Road Width', mkey: '*::line-width-mult', def: 1, min: 0.25, max: 3, step: 0.05 }] },
            { group: 'Railways', layers: [{ id: 'railway', prop: 'line-color', label: 'Railways' },{ id: 'railway_dashline', prop: 'line-color', label: 'Railway Dashes' },{ id: 'railway_transit', prop: 'line-color', label: 'Transit Rail' },{ id: 'railway_transit_dashline', prop: 'line-color', label: 'Transit Dashes' }] },
            { group: 'Boundaries', layers: [{ id: 'boundary_state', prop: 'line-color', label: 'State Borders' },{ id: 'boundary_country_z0-4', prop: 'line-color', label: 'Country Borders (Far)' },{ id: 'boundary_country_z5-', prop: 'line-color', label: 'Country Borders (Near)' }] },
            { group: 'Labels', layers: [{ id: 'highway_name_other', prop: 'text-color', label: 'Road Labels' },{ id: 'highway_name_other', prop: 'text-halo-color', label: 'Road Label Halo' },{ id: 'highway_name_motorway', prop: 'text-color', label: 'Motorway Labels' },{ id: 'place_other', prop: 'text-color', label: 'Hamlet / Neighborhood' },{ id: 'place_other', prop: 'text-halo-color', label: 'Hamlet Halo' },{ id: 'place_village', prop: 'text-color', label: 'Villages' },{ id: 'place_village', prop: 'text-halo-color', label: 'Village Halo' },{ id: 'place_town', prop: 'text-color', label: 'Towns' },{ id: 'place_town', prop: 'text-halo-color', label: 'Town Halo' },{ id: 'place_city', prop: 'text-color', label: 'Cities' },{ id: 'place_city', prop: 'text-halo-color', label: 'City Halo' },{ id: 'place_city_large', prop: 'text-color', label: 'Major Cities' },{ id: 'place_city_large', prop: 'text-halo-color', label: 'Major City Halo' },{ id: 'place_state', prop: 'text-color', label: 'States' },{ id: 'place_state', prop: 'text-halo-color', label: 'State Halo' },{ id: 'place_country_major', prop: 'text-color', label: 'Countries (Major)' },{ id: 'place_country_major', prop: 'text-halo-color', label: 'Country Halo (Major)' },{ id: 'place_country_minor', prop: 'text-color', label: 'Countries (Minor)' },{ id: 'place_country_other', prop: 'text-color', label: 'Countries (Other)' }] },
        ],
        light: [
            { group: 'Base', layers: [{ id: 'background', prop: 'background-color', label: 'Background' }] },
            { group: 'Water', layers: [{ id: 'water', prop: 'fill-color', label: 'Water Fill' },{ id: 'waterway_river', prop: 'line-color', label: 'Rivers' },{ id: 'waterway_other', prop: 'line-color', label: 'Other Waterways' },{ id: 'water_name_point_label', prop: 'text-color', label: 'Water Labels' },{ id: 'water_name_point_label', prop: 'text-halo-color', label: 'Water Label Halo' }] },
            { group: 'Land & Nature', layers: [{ id: 'landcover_ice', prop: 'fill-color', label: 'Ice / Snow' },{ id: 'landcover_wood', prop: 'fill-color', label: 'Forests / Wood' },{ id: 'landcover_grass', prop: 'fill-color', label: 'Grass' },{ id: 'park', prop: 'fill-color', label: 'Parks' },{ id: 'landuse_residential', prop: 'fill-color', label: 'Residential' },{ kind: 'opacity', label: 'Marsh / Wetland (tufts)', okey: 'landcover_wetland::fill-opacity', def: 0.8 }] },
            { group: 'Buildings & Areas', layers: [{ id: 'building', prop: 'fill-color', label: 'Building Fill' },{ id: 'aeroway_fill', prop: 'fill-color', label: 'Airport Area' }] },
            { group: 'Roads', layers: [{ label: 'Paths / Pedestrian', keys: ['road_path_pedestrian::line-color','bridge_path_pedestrian::line-color','tunnel_path_pedestrian::line-color'] },{ label: 'Minor Roads', keys: ['road_minor::line-color','bridge_street::line-color','tunnel_minor::line-color'] },{ label: 'Minor Casing', keys: ['road_minor_casing::line-color','bridge_street_casing::line-color','tunnel_street_casing::line-color'] },{ label: 'Service / Track', keys: ['road_service_track::line-color','bridge_service_track::line-color','tunnel_service_track::line-color'] },{ label: 'Service / Track Casing', keys: ['road_service_track_casing::line-color','bridge_service_track_casing::line-color','tunnel_service_track_casing::line-color'] },{ label: 'Secondary / Tertiary', keys: ['road_secondary_tertiary::line-color','bridge_secondary_tertiary::line-color','tunnel_secondary_tertiary::line-color'] },{ label: 'Secondary / Tertiary Casing', keys: ['road_secondary_tertiary_casing::line-color','bridge_secondary_tertiary_casing::line-color','tunnel_secondary_tertiary_casing::line-color'] },{ label: 'Trunk / Primary', keys: ['road_trunk_primary::line-color','bridge_trunk_primary::line-color','tunnel_trunk_primary::line-color'] },{ label: 'Trunk / Primary Casing', keys: ['road_trunk_primary_casing::line-color','bridge_trunk_primary_casing::line-color','tunnel_trunk_primary_casing::line-color'] },{ label: 'Ramps / Links', keys: ['road_link::line-color','bridge_link::line-color','tunnel_link::line-color'] },{ label: 'Ramps / Links Casing', keys: ['road_link_casing::line-color','bridge_link_casing::line-color','tunnel_link_casing::line-color'] },{ label: 'Motorway', keys: ['road_motorway::line-color','bridge_motorway::line-color','tunnel_motorway::line-color'] },{ label: 'Motorway Casing', keys: ['road_motorway_casing::line-color','bridge_motorway_casing::line-color','tunnel_motorway_casing::line-color'] },{ label: 'Motorway Links', keys: ['road_motorway_link::line-color','bridge_motorway_link::line-color','tunnel_motorway_link::line-color'] },{ label: 'Motorway Link Casing', keys: ['road_motorway_link_casing::line-color','bridge_motorway_link_casing::line-color','tunnel_motorway_link_casing::line-color'] },{ kind: 'mult', label: 'Road Width', mkey: '*::line-width-mult', def: 1, min: 0.25, max: 3, step: 0.05 }] },
            { group: 'Railways', layers: [{ id: 'road_major_rail', prop: 'line-color', label: 'Railways' },{ id: 'road_major_rail_hatching', prop: 'line-color', label: 'Railway Hatching' },{ id: 'road_transit_rail', prop: 'line-color', label: 'Transit Rail' },{ id: 'road_transit_rail_hatching', prop: 'line-color', label: 'Transit Hatching' }] },
            { group: 'Boundaries', layers: [{ id: 'boundary_3', prop: 'line-color', label: 'State Borders' },{ id: 'boundary_2', prop: 'line-color', label: 'Country Borders' },{ id: 'boundary_disputed', prop: 'line-color', label: 'Disputed Borders' }] },
            { group: 'Labels', layers: [{ id: 'highway-name-minor', prop: 'text-color', label: 'Road Labels' },{ id: 'highway-name-major', prop: 'text-color', label: 'Major Road Labels' },{ id: 'label_other', prop: 'text-color', label: 'Hamlet / Neighborhood' },{ id: 'label_other', prop: 'text-halo-color', label: 'Hamlet Halo' },{ id: 'label_village', prop: 'text-color', label: 'Villages' },{ id: 'label_village', prop: 'text-halo-color', label: 'Village Halo' },{ id: 'label_town', prop: 'text-color', label: 'Towns' },{ id: 'label_town', prop: 'text-halo-color', label: 'Town Halo' },{ id: 'label_city', prop: 'text-color', label: 'Cities' },{ id: 'label_city', prop: 'text-halo-color', label: 'City Halo' },{ id: 'label_city_capital', prop: 'text-color', label: 'Capital Cities' },{ id: 'label_city_capital', prop: 'text-halo-color', label: 'Capital City Halo' },{ id: 'label_state', prop: 'text-color', label: 'States' },{ id: 'label_state', prop: 'text-halo-color', label: 'State Halo' },{ id: 'label_country_1', prop: 'text-color', label: 'Countries (Major)' },{ id: 'label_country_1', prop: 'text-halo-color', label: 'Country Halo (Major)' },{ id: 'label_country_2', prop: 'text-color', label: 'Countries (Minor)' },{ id: 'label_country_3', prop: 'text-color', label: 'Countries (Other)' }] },
        ],
    };

    const SIMPLE_LAYERS = {
        dark: [
            { group: 'Base', layers: [{ label: 'Background', keys: ['background::background-color'] }] },
            { group: 'Water', layers: [{ label: 'Water', keys: ['water::fill-color','waterway::line-color'] },{ label: 'Water Labels', keys: ['water_name::text-color'] },{ label: 'Water Label Halo', keys: ['water_name::text-halo-color'] }] },
            { group: 'Land & Nature', layers: [{ label: 'Nature / Parks', keys: ['landcover_wood::fill-color','landuse_park::fill-color','landcover_ice_shelf::fill-color','landcover_glacier::fill-color'] },{ label: 'Residential', keys: ['landuse_residential::fill-color'] }] },
            { group: 'Buildings & Areas', layers: [{ label: 'Buildings', keys: ['building::fill-color','building::fill-outline-color'] },{ label: 'Airports / Piers', keys: ['aeroway-area::fill-color','road_area_pier::fill-color'] }] },
            { group: 'Roads', layers: [{ label: 'Minor Roads', keys: ['highway_path::line-color','highway_minor::line-color','road_pier::line-color'] },{ label: 'Major Roads', keys: ['highway_major_inner::line-color','highway_major_casing::line-color','highway_major_subtle::line-color'] },{ label: 'Motorways', keys: ['highway_motorway_inner::line-color','highway_motorway_casing::line-color','highway_motorway_subtle::line-color'] },{ kind: 'mult', label: 'Road Width', mkey: '*::line-width-mult', def: 1, min: 0.25, max: 3, step: 0.05 }] },
            { group: 'Railways', layers: [{ label: 'All Railways', keys: ['railway::line-color','railway_dashline::line-color','railway_transit::line-color','railway_transit_dashline::line-color'] }] },
            { group: 'Boundaries', layers: [{ label: 'All Borders', keys: ['boundary_state::line-color','boundary_country_z0-4::line-color','boundary_country_z5-::line-color'] }] },
            { group: 'Labels', layers: [{ label: 'Road Labels', keys: ['highway_name_other::text-color','highway_name_motorway::text-color'] },{ label: 'Road Label Halo', keys: ['highway_name_other::text-halo-color'] },{ label: 'Place Labels', keys: ['place_other::text-color','place_village::text-color','place_town::text-color','place_city::text-color','place_city_large::text-color','place_state::text-color','place_country_major::text-color','place_country_minor::text-color','place_country_other::text-color'] },{ label: 'Place Label Halo', keys: ['place_other::text-halo-color','place_village::text-halo-color','place_town::text-halo-color','place_city::text-halo-color','place_city_large::text-halo-color','place_state::text-halo-color','place_country_major::text-halo-color'] }] },
        ],
        light: [
            { group: 'Base', layers: [{ label: 'Background', keys: ['background::background-color'] }] },
            { group: 'Water', layers: [{ label: 'Water', keys: ['water::fill-color','waterway_river::line-color','waterway_other::line-color'] },{ label: 'Water Labels', keys: ['water_name_point_label::text-color','water_name_line_label::text-color'] },{ label: 'Water Label Halo', keys: ['water_name_point_label::text-halo-color','water_name_line_label::text-halo-color'] }] },
            { group: 'Land & Nature', layers: [{ label: 'Nature / Parks', keys: ['landcover_wood::fill-color','landcover_grass::fill-color','park::fill-color','landcover_ice::fill-color'] },{ label: 'Residential', keys: ['landuse_residential::fill-color'] },{ kind: 'opacity', label: 'Marsh / Wetland (tufts)', okey: 'landcover_wetland::fill-opacity', def: 0.8 }] },
            { group: 'Buildings & Areas', layers: [{ label: 'Buildings', keys: ['building::fill-color'] },{ label: 'Airports', keys: ['aeroway_fill::fill-color'] }] },
            { group: 'Roads', layers: [{ label: 'Minor Roads', keys: ['road_path_pedestrian::line-color','bridge_path_pedestrian::line-color','tunnel_path_pedestrian::line-color','bridge_path_pedestrian_casing::line-color','road_minor::line-color','bridge_street::line-color','tunnel_minor::line-color','road_minor_casing::line-color','bridge_street_casing::line-color','tunnel_street_casing::line-color','road_service_track::line-color','bridge_service_track::line-color','tunnel_service_track::line-color','road_service_track_casing::line-color','bridge_service_track_casing::line-color','tunnel_service_track_casing::line-color','road_link::line-color','bridge_link::line-color','tunnel_link::line-color','road_link_casing::line-color','bridge_link_casing::line-color','tunnel_link_casing::line-color'] },{ label: 'Major Roads', keys: ['road_secondary_tertiary::line-color','bridge_secondary_tertiary::line-color','tunnel_secondary_tertiary::line-color','road_secondary_tertiary_casing::line-color','bridge_secondary_tertiary_casing::line-color','tunnel_secondary_tertiary_casing::line-color','road_trunk_primary::line-color','bridge_trunk_primary::line-color','tunnel_trunk_primary::line-color','road_trunk_primary_casing::line-color','bridge_trunk_primary_casing::line-color','tunnel_trunk_primary_casing::line-color'] },{ label: 'Motorways', keys: ['road_motorway::line-color','bridge_motorway::line-color','tunnel_motorway::line-color','road_motorway_casing::line-color','bridge_motorway_casing::line-color','tunnel_motorway_casing::line-color','road_motorway_link::line-color','bridge_motorway_link::line-color','tunnel_motorway_link::line-color','road_motorway_link_casing::line-color','bridge_motorway_link_casing::line-color','tunnel_motorway_link_casing::line-color'] },{ kind: 'mult', label: 'Road Width', mkey: '*::line-width-mult', def: 1, min: 0.25, max: 3, step: 0.05 }] },
            { group: 'Railways', layers: [{ label: 'All Railways', keys: ['road_major_rail::line-color','road_major_rail_hatching::line-color','road_transit_rail::line-color','road_transit_rail_hatching::line-color'] }] },
            { group: 'Boundaries', layers: [{ label: 'All Borders', keys: ['boundary_3::line-color','boundary_2::line-color','boundary_disputed::line-color'] }] },
            { group: 'Labels', layers: [{ label: 'Road Labels', keys: ['highway-name-minor::text-color','highway-name-major::text-color'] },{ label: 'Place Labels', keys: ['label_other::text-color','label_village::text-color','label_town::text-color','label_city::text-color','label_city_capital::text-color','label_state::text-color','label_country_1::text-color','label_country_2::text-color','label_country_3::text-color'] },{ label: 'Place Label Halo', keys: ['label_other::text-halo-color','label_village::text-halo-color','label_town::text-halo-color','label_city::text-halo-color','label_city_capital::text-halo-color','label_state::text-halo-color','label_country_1::text-halo-color'] }] },
        ],
    };

    const BASE_DEFAULTS = {
        dark: {'background::background-color':'#0c0c0c','water::fill-color':'#1b1b1d','waterway::line-color':'#1b1b1d','water_name::text-color':'#000000','water_name::text-halo-color':'#454545','landcover_ice_shelf::fill-color':'#0c0c0c','landcover_glacier::fill-color':'#050505','landcover_wood::fill-color':'#202020','landuse_park::fill-color':'#202020','landuse_residential::fill-color':'#0d0d0d','building::fill-color':'#0a0a0a','building::fill-outline-color':'#1b1b1d','aeroway-area::fill-color':'#000000','road_area_pier::fill-color':'#0c0c0c','road_pier::line-color':'#0c0c0c','highway_path::line-color':'#1b1b1d','highway_minor::line-color':'#181818','highway_major_inner::line-color':'#121212','highway_major_casing::line-color':'#3c3c3c','highway_major_subtle::line-color':'#2a2a2a','highway_motorway_inner::line-color':'#000000','highway_motorway_casing::line-color':'#3c3c3c','highway_motorway_subtle::line-color':'#181818','railway::line-color':'#232323','railway_dashline::line-color':'#0c0c0c','railway_transit::line-color':'#232323','railway_transit_dashline::line-color':'#0c0c0c','boundary_state::line-color':'#363636','boundary_country_z0-4::line-color':'#3b3b3b','boundary_country_z5-::line-color':'#3b3b3b','highway_name_other::text-color':'#504e4e','highway_name_other::text-halo-color':'#000000','highway_name_motorway::text-color':'#5e5e5e','place_other::text-color':'#656565','place_other::text-halo-color':'#000000','place_village::text-color':'#656565','place_village::text-halo-color':'#000000','place_town::text-color':'#656565','place_town::text-halo-color':'#000000','place_city::text-color':'#656565','place_city::text-halo-color':'#000000','place_city_large::text-color':'#656565','place_city_large::text-halo-color':'#000000','place_state::text-color':'#656565','place_state::text-halo-color':'#000000','place_country_other::text-color':'#656565','place_country_other::text-halo-color':'#000000','place_country_minor::text-color':'#656565','place_country_minor::text-halo-color':'#000000','place_country_major::text-color':'#656565','place_country_major::text-halo-color':'#000000'},
        light: {'background::background-color':'#f8f4f0','water::fill-color':'#9ebdff','waterway_river::line-color':'#a0c8f0','waterway_other::line-color':'#a0c8f0','water_name_point_label::text-color':'#495e91','water_name_point_label::text-halo-color':'#ffffff','water_name_line_label::text-color':'#495e91','water_name_line_label::text-halo-color':'#ffffff','landcover_ice::fill-color':'#e0ecec','landcover_wood::fill-color':'#a4d898','landcover_grass::fill-color':'#b0d59a','park::fill-color':'#d8e8c8','landuse_residential::fill-color':'#e8dece','building::fill-color':'#d4cfc9','aeroway_fill::fill-color':'#e5e4e0','road_path_pedestrian::line-color':'#ffffff','road_minor::line-color':'#ffffff','road_secondary_tertiary::line-color':'#ffeeaa','road_trunk_primary::line-color':'#ffeeaa','road_trunk_primary_casing::line-color':'#e9ac77','road_motorway::line-color':'#ffcc88','road_motorway_casing::line-color':'#e9ac77','road_motorway_link::line-color':'#ffcc88','road_minor_casing::line-color':'#cfcdca','road_service_track::line-color':'#ffffff','road_service_track_casing::line-color':'#cfcdca','road_secondary_tertiary_casing::line-color':'#e9ac77','road_link::line-color':'#ffeeaa','road_link_casing::line-color':'#e9ac77','road_motorway_link_casing::line-color':'#e9ac77','road_major_rail::line-color':'#bbbbbb','road_major_rail_hatching::line-color':'#bbbbbb','road_transit_rail::line-color':'#bbbbbb','road_transit_rail_hatching::line-color':'#bbbbbb','boundary_3::line-color':'#b3b3b3','boundary_2::line-color':'#696969','boundary_disputed::line-color':'#696969','highway-name-minor::text-color':'#666666','highway-name-major::text-color':'#666666','label_other::text-color':'#333333','label_other::text-halo-color':'#ffffff','label_village::text-color':'#000000','label_village::text-halo-color':'#ffffff','label_town::text-color':'#000000','label_town::text-halo-color':'#ffffff','label_city::text-color':'#000000','label_city::text-halo-color':'#ffffff','label_city_capital::text-color':'#000000','label_city_capital::text-halo-color':'#ffffff','label_state::text-color':'#333333','label_state::text-halo-color':'#ffffff','label_country_1::text-color':'#000000','label_country_1::text-halo-color':'#ffffff','label_country_2::text-color':'#000000','label_country_2::text-halo-color':'#ffffff','label_country_3::text-color':'#000000','label_country_3::text-halo-color':'#ffffff'}
    };

    function getEditableLayers(base) { return EDITABLE_LAYERS[base] || EDITABLE_LAYERS.dark; }
    function getSimpleLayers(base) { return SIMPLE_LAYERS[base] || SIMPLE_LAYERS.dark; }
    function getDefaultColor(key, base) { return (BASE_DEFAULTS[base] || BASE_DEFAULTS.dark)[key] || '#808080'; }

    // ─── Storage Helpers ─────────────────────────────────────────────
    function teLoadThemes() {
        let themes = {};
        try { themes = JSON.parse(localStorage.getItem(TE_STORAGE_KEY)) || {}; } catch {}
        for (const [key, bundled] of Object.entries(BUNDLED_THEMES)) {
            const name = bundled.name;
            if (!themes[name] || !themes[name].bundled) {
                themes[name] = { overrides: { ...bundled.overrides }, base: bundled.base, bundled: true, createdAt: themes[name]?.createdAt || Date.now(), updatedAt: Date.now() };
            }
            if (name === 'Debug White' && !themes[name].overrides['*::all-color']) themes[name].overrides['*::all-color'] = '#ffffff';
            if (name === 'Debug Black' && !themes[name].overrides['*::all-color']) themes[name].overrides['*::all-color'] = '#000000';
        }
        if (!localStorage.getItem(TE_MINOR_ROAD_KEY)) {
            for (const bundled of Object.values(BUNDLED_THEMES)) {
                const theme = themes[bundled.name];
                if (!theme || !theme.bundled || bundled.name === 'Debug White' || bundled.name === 'Debug Black') continue;
                const keys = HIDE_MINOR_ROAD_KEYS[theme.base || 'dark'] || [];
                for (const k of keys) { const cur = theme.overrides[k]; const orig = bundled.overrides[k]; if (cur == null || cur === orig) theme.overrides[k] = 'transparent'; }
                theme.updatedAt = Date.now();
            }
            localStorage.setItem(TE_MINOR_ROAD_KEY, '1');
        }
        if (!localStorage.getItem(TE_FEEDBACK_KEY)) {
            const dg = themes['Discord Gold']; if (dg?.bundled) { dg.overrides['background::background-color'] = '#171717'; dg.overrides['landuse_residential::fill-color'] = 'transparent'; dg.updatedAt = Date.now(); }
            const cp = themes['Cute & Pink']; if (cp?.bundled) { cp.overrides['landuse_residential::fill-color'] = 'transparent'; cp.updatedAt = Date.now(); }
            const mk = themes['Monokai']; if (mk?.bundled) { mk.overrides['background::background-color'] = '#000000'; mk.overrides['landuse_residential::fill-color'] = 'transparent'; mk.overrides['highway_major_subtle::line-color'] = '#273a2d'; mk.updatedAt = Date.now(); }
            localStorage.setItem(TE_FEEDBACK_KEY, '1');
        }
        teSaveThemes(themes);
        return themes;
    }
    function teSaveThemes(themes) { localStorage.setItem(TE_STORAGE_KEY, JSON.stringify(themes)); }
    function teGetActive() { return localStorage.getItem(TE_ACTIVE_KEY) || ''; }
    function teSetActive(name) { localStorage.setItem(TE_ACTIVE_KEY, name); }

    // ─── Color Helpers ───────────────────────────────────────────────
    function colorToHex(color) {
        if (!color || typeof color !== 'string') return '#000000';
        if (/^#[0-9A-Fa-f]{6}$/.test(color)) return color;
        if (/^#[0-9A-Fa-f]{3}$/.test(color)) { const [,r,g,b] = color.match(/^#(.)(.)(.)$/); return '#'+r+r+g+g+b+b; }
        const tmp = document.createElement('div'); tmp.style.color = color; document.body.appendChild(tmp);
        const computed = getComputedStyle(tmp).color; document.body.removeChild(tmp);
        const m = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!m) return '#000000';
        const hex = n => parseInt(n,10).toString(16).padStart(2,'0');
        return '#'+hex(m[1])+hex(m[2])+hex(m[3]);
    }
    function isColorDark(hex) { const h = colorToHex(hex).replace('#',''); const r = parseInt(h.substring(0,2),16)/255; const g = parseInt(h.substring(2,4),16)/255; const b = parseInt(h.substring(4,6),16)/255; return (0.299*r+0.587*g+0.114*b) < 0.4; }

    // ─── Base Style Templates ────────────────────────────────────────
    let lightStyleTemplate = null, darkStyleTemplate = null;
    async function fetchStyle(endpoint) { let text = await fetch(TE_BASE_URL + endpoint).then(r => r.text()); text = text.replaceAll('http://localhost:5039', TE_BASE_URL); return JSON.parse(text); }
    async function getBaseStyle(base) {
        if (base === 'dark') { if (!darkStyleTemplate) { try { darkStyleTemplate = await fetchStyle('/styleDark'); } catch { return null; } } return JSON.parse(JSON.stringify(darkStyleTemplate)); }
        if (!lightStyleTemplate) { try { lightStyleTemplate = await fetchStyle('/style'); } catch { return null; } } return JSON.parse(JSON.stringify(lightStyleTemplate));
    }

    // ─── Style Builder ───────────────────────────────────────────────
    // Scale a MapLibre line-width value by a multiplier, preserving zoom scaling.
    // Handles: plain number, legacy {base,stops} function, and expression arrays.
    function scaleLineWidth(v, m) {
        if (v == null || !(m > 0)) return v;
        if (typeof v === 'number') return v * m;
        if (Array.isArray(v)) return ['*', v, m];
        if (typeof v === 'object' && Array.isArray(v.stops)) return Object.assign({}, v, { stops: v.stops.map(s => [s[0], typeof s[1] === 'number' ? s[1] * m : s[1]]) });
        return v;
    }

    function buildStyle(baseStyle, overrides) {
        const style = JSON.parse(JSON.stringify(baseStyle));
        const allColor = overrides['*::all-color'];
        const widthMult = parseFloat(overrides['*::line-width-mult']);
        const scaleRoads = !isNaN(widthMult) && widthMult > 0 && widthMult !== 1;
        for (const layer of style.layers) {
            if (allColor && layer.paint) {
                if (layer.paint['background-color'] != null) layer.paint['background-color'] = allColor;
                if (layer.paint['fill-color'] != null) layer.paint['fill-color'] = allColor;
                if (layer.paint['fill-outline-color'] != null) layer.paint['fill-outline-color'] = allColor;
                if (layer.paint['line-color'] != null) layer.paint['line-color'] = allColor;
                if (layer.paint['text-color'] != null) layer.paint['text-color'] = allColor;
                if (layer.paint['text-halo-color'] != null) layer.paint['text-halo-color'] = allColor;
                if (layer.type === 'raster' && layer.paint['raster-opacity'] != null) layer.paint['raster-opacity'] = 0;
                if (layer.type === 'symbol') layer.paint['icon-opacity'] = 0;
            }
            const check = (prop) => { const key = layer.id+'::'+prop; if (overrides[key]) { if (!layer.paint) layer.paint = {}; layer.paint[prop] = overrides[key]; } };
            const checkNum = (prop) => { const key = layer.id+'::'+prop; const val = overrides[key]; if (val != null && val !== '') { const num = parseFloat(val); if (!isNaN(num)) { if (!layer.paint) layer.paint = {}; layer.paint[prop] = num; } } };
            if (layer.type === 'background') check('background-color');
            if (layer.type === 'fill') { check('fill-color'); check('fill-outline-color'); checkNum('fill-opacity'); }
            if (layer.type === 'line') { check('line-color'); if (scaleRoads && layer['source-layer'] === 'transportation' && layer.paint && layer.paint['line-width'] != null) layer.paint['line-width'] = scaleLineWidth(layer.paint['line-width'], widthMult); }
            if (layer.type === 'symbol') { check('text-color'); check('text-halo-color'); }
        }
        return style;
    }

    function readColorsFromStyle(style, base) {
        const overrides = {};
        const readKey = (key) => {
            const idx = key.indexOf('::'); if (idx < 0) return;
            const id = key.slice(0, idx), prop = key.slice(idx + 2);
            const layer = style.layers.find(l => l.id === id);
            if (layer?.paint?.[prop] != null) { let val = layer.paint[prop]; if (typeof val === 'object' && !Array.isArray(val) && val.stops) val = val.stops[val.stops.length-1][1]; if (typeof val === 'string') overrides[key] = colorToHex(val); }
        };
        for (const group of getEditableLayers(base || 'dark')) {
            for (const entry of group.layers) {
                if (entry.kind) continue;
                if (entry.keys) entry.keys.forEach(readKey);
                else readKey(entry.id + '::' + entry.prop);
            }
        }
        return overrides;
    }

    function readAllColorsFromStyle(style) {
        const propMap = { background: ['background-color'], fill: ['fill-color','fill-outline-color'], line: ['line-color'], symbol: ['text-color','text-halo-color'] };
        const overrides = {};
        for (const layer of style.layers) { const props = propMap[layer.type]; if (!props || !layer.paint) continue; for (const p of props) { let val = layer.paint[p]; if (val == null) continue; if (typeof val === 'object' && !Array.isArray(val) && val.stops) val = val.stops[val.stops.length-1][1]; if (typeof val === 'string') overrides[layer.id+'::'+p] = colorToHex(val); } }
        return overrides;
    }

    // ─── Map Integration ─────────────────────────────────────────────
    function teGetMap() {
        try { const m = (0, eval)('map'); if (m && typeof m.setStyle === 'function') return m; } catch {}
        if (typeof unsafeWindow !== 'undefined') { try { const m = unsafeWindow.eval('map'); if (m && typeof m.setStyle === 'function') return m; } catch {} }
        return null;
    }
    function teGetUserConfig() { if (typeof unsafeWindow !== 'undefined' && unsafeWindow.userConfig) return unsafeWindow.userConfig; if (window.userConfig) return window.userConfig; try { return JSON.parse(localStorage.getItem('userConfig')); } catch { return null; } }
    function inferBase(style) { if (!style?.layers) return 'dark'; const ids = new Set(style.layers.map(l => l.id)); if (ids.has('road_minor') || ids.has('highway-name-minor') || ids.has('boundary_3')) return 'light'; return 'dark'; }

    function setStyleCustomInPage(style) {
        const json = JSON.stringify(style).replace(/</g, '\\u003c');
        const code = 'styleCustom = ' + json;
        try { if (window.wrappedJSObject?.eval) { window.wrappedJSObject.eval(code); return true; } } catch {}
        try { const s = document.createElement('script'); s.textContent = '(function(){try{'+code+'}catch(e){}})();'; (document.head||document.documentElement).appendChild(s); s.remove(); return true; } catch {}
        try { (0, eval)(code); return true; } catch {}
        return false;
    }

    function applyStyleInPlace(map, style) {
        const liveStyle = map.getStyle(); if (!liveStyle?.layers) return false;
        const liveIds = new Set(liveStyle.layers.map(l => l.id));
        const allowed = new Set(['background-color','fill-color','fill-outline-color','line-color','text-color','text-halo-color','icon-opacity','raster-opacity','fill-opacity','line-width']);
        for (const layer of style.layers||[]) { if (!liveIds.has(layer.id) || !layer.paint) continue; for (const [prop,value] of Object.entries(layer.paint)) { if (!allowed.has(prop)) continue; try { map.setPaintProperty(layer.id, prop, value); } catch {} } }
        return true;
    }

    function triggerRepaint() { try { (0, eval)('try{if(typeof drawCachedTilesOnMap==="function")drawCachedTilesOnMap()}catch(e){};try{if(typeof synchronize==="function")synchronize("partial")}catch(e){};try{if(typeof refresh==="function")refresh()}catch(e){}'); } catch {} }

    function applyStyleToMap(style, targetBase) {
        localStorage.setItem('customTheme', JSON.stringify(style));
        const uc = teGetUserConfig() || {}; uc.theme = 'custom'; localStorage.setItem('userConfig', JSON.stringify(uc));
        const map = teGetMap(); if (!map) { teShowToast('Map not found — please wait for the page to load.', true); return; }
        const liveStyle = map.getStyle ? map.getStyle() : null;
        const liveBase = inferBase(liveStyle); const desiredBase = targetBase || inferBase(style);
        if (liveStyle && liveBase === desiredBase) { applyStyleInPlace(map, style); setStyleCustomInPage(style); return; }
        const applyFull = (attempt = 0) => {
            try { if (map.isStyleLoaded && !map.isStyleLoaded()) { if (attempt < 40) return setTimeout(() => applyFull(attempt+1), 75); }
                map.setStyle(style); setStyleCustomInPage(style);
                const kick = () => { triggerRepaint(); setTimeout(triggerRepaint, 120); setTimeout(triggerRepaint, 450); };
                try { map.once('styledata', kick); } catch {} try { map.once('idle', kick); } catch {}
            } catch (e) { if (attempt < 40) return setTimeout(() => applyFull(attempt+1), 75);
                const json = JSON.stringify(style).replace(/</g, '\\u003c');
                try { const s = document.createElement('script'); s.textContent = '(function(){try{styleCustom='+json+';applyTheme("custom")}catch(e){}})();'; (document.head||document.documentElement).appendChild(s); s.remove(); triggerRepaint(); setTimeout(triggerRepaint,120); setTimeout(triggerRepaint,450); } catch { teShowToast('Failed to switch base style.', true); }
            }
        };
        applyFull();
    }

    function persistTheme(style) { localStorage.setItem('customTheme', JSON.stringify(style)); const uc = teGetUserConfig() || {}; uc.theme = 'custom'; localStorage.setItem('userConfig', JSON.stringify(uc)); }

    // ─── Toast ───────────────────────────────────────────────────────
    function teShowToast(msg, isError) {
        const existing = document.getElementById('gte-toast'); if (existing) existing.remove();
        const toast = document.createElement('div'); toast.id = 'gte-toast'; toast.textContent = msg;
        Object.assign(toast.style, { position:'fixed',bottom:'20px',left:'50%',transform:'translateX(-50%)',background:isError?'#f38ba8':'#a6e3a1',color:'#1e1e2e',padding:'8px 18px',borderRadius:'8px',fontSize:'12px',fontWeight:'600',zIndex:'100001',boxShadow:'0 4px 12px rgba(0,0,0,.3)',transition:'opacity .3s',fontFamily:"'Segoe UI',system-ui,sans-serif" });
        document.body.appendChild(toast); setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2500);
    }

    // ─── HTML Utils ──────────────────────────────────────────────────
    function teEscHTML(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
    function teEscAttr(str) { return str.replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    // ─── CSS ─────────────────────────────────────────────────────────
    function teInjectCSS() {
        if (document.getElementById('gte-style')) return;
        const css = document.createElement('style'); css.id = 'gte-style';
        css.textContent = `
            #gte-modal { position:fixed; z-index:100000; background:#1e1e2e; color:#cdd6f4; border:1px solid #45475a; border-radius:12px; box-shadow:0 8px 32px rgba(0,0,0,.55); width:380px; max-height:80vh; display:flex; flex-direction:column; font-family:'Segoe UI',system-ui,sans-serif; font-size:13px; user-select:none; }
            #gte-modal.gte-hidden { display:none; }
            #gte-titlebar { display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:#181825; border-radius:12px 12px 0 0; cursor:grab; flex-shrink:0; }
            #gte-titlebar:active { cursor:grabbing; }
            #gte-titlebar h2 { margin:0; font-size:14px; font-weight:600; color:#cba6f7; }
            #gte-close-btn { background:none; border:none; color:#6c7086; cursor:pointer; font-size:18px; line-height:1; padding:0 4px; }
            #gte-close-btn:hover { color:#f38ba8; }
            #gte-tabs { display:flex; border-bottom:1px solid #313244; flex-shrink:0; }
            .gte-tab { flex:1; padding:8px 0; text-align:center; background:none; border:none; color:#6c7086; cursor:pointer; font-size:12px; font-weight:500; border-bottom:2px solid transparent; transition:color .15s,border-color .15s; }
            .gte-tab:hover { color:#bac2de; }
            .gte-tab.gte-active { color:#cba6f7; border-bottom-color:#cba6f7; }
            #gte-body { overflow-y:auto; padding:12px 14px; flex:1; }
            #gte-body::-webkit-scrollbar { width:6px; }
            #gte-body::-webkit-scrollbar-thumb { background:#45475a; border-radius:3px; }
            .gte-panel { display:none; }
            .gte-panel.gte-active { display:block; }
            .gte-group-header { font-size:11px; font-weight:700; text-transform:uppercase; color:#89b4fa; margin:12px 0 6px; letter-spacing:.5px; }
            .gte-group-header:first-child { margin-top:0; }
            .gte-color-row { display:flex; align-items:center; justify-content:space-between; padding:4px 0; }
            .gte-color-label { font-size:12px; color:#a6adc8; }
            .gte-color-input-wrap { display:flex; align-items:center; gap:6px; }
            .gte-color-input { -webkit-appearance:none; appearance:none; width:32px; height:24px; border:1px solid #45475a; border-radius:4px; cursor:pointer; background:none; padding:0; }
            .gte-color-input::-webkit-color-swatch-wrapper { padding:0; }
            .gte-color-input::-webkit-color-swatch { border:none; border-radius:3px; }
            .gte-hex-display { font-family:'Cascadia Code','Consolas',monospace; font-size:11px; color:#6c7086; width:62px; text-align:right; }
            .gte-hex-display.gte-hidden-color { color:#f38ba8; font-style:italic; }
            .gte-range { -webkit-appearance:none; appearance:none; width:80px; height:4px; border-radius:2px; background:#45475a; outline:none; cursor:pointer; accent-color:#cba6f7; padding:0; }
            .gte-range::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:12px; height:12px; border-radius:50%; background:#cba6f7; cursor:pointer; border:none; }
            .gte-range::-moz-range-thumb { width:12px; height:12px; border-radius:50%; background:#cba6f7; cursor:pointer; border:none; }
            .gte-vis-btn { background:none; border:none; cursor:pointer; font-size:14px; padding:0 2px; line-height:1; opacity:0.6; transition:opacity .15s; }
            .gte-vis-btn:hover { opacity:1; }
            .gte-vis-btn.gte-layer-hidden { opacity:0.35; }
            .gte-reset-btn { background:none; border:none; cursor:pointer; font-size:11px; padding:0 2px; line-height:1; opacity:0.5; transition:opacity .15s; color:#89b4fa; }
            .gte-reset-btn:hover { opacity:1; }
            .gte-name-row { display:flex; gap:8px; margin-bottom:12px; }
            .gte-name-input { flex:1; padding:6px 10px; border-radius:6px; background:#313244; color:#cdd6f4; border:1px solid #45475a; font-size:13px; outline:none; }
            .gte-name-input:focus { border-color:#cba6f7; }
            .gte-name-input::placeholder { color:#585b70; }
            .gte-preview-row { display:flex; align-items:center; gap:8px; margin-bottom:10px; padding:6px 8px; background:#313244; border-radius:6px; }
            .gte-preview-row input[type=checkbox] { accent-color:#cba6f7; width:15px; height:15px; cursor:pointer; }
            .gte-preview-row label { font-size:12px; color:#a6adc8; cursor:pointer; user-select:none; }
            .gte-mode-toggle { display:flex; align-items:center; gap:8px; margin-bottom:10px; padding:6px 8px; background:#313244; border-radius:6px; }
            .gte-mode-toggle span { font-size:12px; color:#a6adc8; }
            .gte-mode-toggle span.gte-mode-active { color:#cba6f7; font-weight:600; }
            .gte-mode-switch { position:relative; width:36px; height:18px; background:#585b70; border-radius:9px; cursor:pointer; transition:background .2s; border:none; padding:0; }
            .gte-mode-switch.gte-on { background:#cba6f7; }
            .gte-mode-switch::after { content:''; position:absolute; top:2px; left:2px; width:14px; height:14px; background:#fff; border-radius:50%; transition:transform .2s; }
            .gte-mode-switch.gte-on::after { transform:translateX(18px); }
            .gte-btn { padding:7px 14px; border:none; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; transition:filter .15s; }
            .gte-btn:hover { filter:brightness(1.15); }
            .gte-btn-primary { background:#cba6f7; color:#1e1e2e; }
            .gte-btn-secondary { background:#45475a; color:#cdd6f4; }
            .gte-btn-danger { background:#f38ba8; color:#1e1e2e; }
            .gte-btn-sm { padding:4px 10px; font-size:11px; }
            .gte-btn-row { display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; }
            .gte-theme-card { display:flex; align-items:center; justify-content:space-between; padding:8px 10px; margin-bottom:6px; background:#313244; border-radius:8px; border:1px solid transparent; transition:border-color .15s; }
            .gte-theme-card.gte-active-theme { border-color:#a6e3a1; }
            .gte-theme-card-name { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:500; color:#cdd6f4; overflow:hidden; max-width:180px; }
            .gte-theme-name-text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .gte-theme-badge { font-size:10px; font-weight:700; letter-spacing:0.2px; text-transform:uppercase; border-radius:999px; padding:2px 6px; line-height:1; flex-shrink:0; border:1px solid transparent; }
            .gte-theme-badge-light { color:#1e1e2e; background:#f9e2af; border-color:#eabf5d; }
            .gte-theme-badge-dark { color:#cdd6f4; background:#313244; border-color:#585b70; }
            .gte-theme-card-actions { display:flex; gap:4px; }
            .gte-empty-msg { color:#585b70; font-size:12px; text-align:center; padding:20px 0; }
            .gte-io-section { margin-top:14px; padding-top:12px; border-top:1px solid #313244; }
        `;
        document.head.appendChild(css);
    }

    // ─── Modal ───────────────────────────────────────────────────────
    let teModal = null;

    function teBuildModal() {
        const modal = document.createElement('div'); modal.id = 'gte-modal'; modal.className = 'gte-hidden';
        modal.innerHTML = '<div id="gte-titlebar"><h2>\ud83c\udfa8 Theme Editor</h2><button id="gte-close-btn">&times;</button></div><div id="gte-tabs"><button class="gte-tab gte-active" data-panel="editor">Editor</button><button class="gte-tab" data-panel="manager">My Themes</button></div><div id="gte-body"><div id="gte-panel-editor" class="gte-panel gte-active"></div><div id="gte-panel-manager" class="gte-panel"></div></div>';
        document.body.appendChild(modal);
        modal.style.top = '60px'; modal.style.right = '20px';
        modal.querySelector('#gte-close-btn').addEventListener('click', () => modal.classList.add('gte-hidden'));
        modal.querySelectorAll('.gte-tab').forEach(tab => tab.addEventListener('click', () => {
            modal.querySelectorAll('.gte-tab').forEach(t => t.classList.remove('gte-active'));
            modal.querySelectorAll('.gte-panel').forEach(p => p.classList.remove('gte-active'));
            tab.classList.add('gte-active'); modal.querySelector('#gte-panel-'+tab.dataset.panel).classList.add('gte-active');
            if (tab.dataset.panel === 'manager') renderManager();
        }));
        // Dragging
        let ox=0,oy=0,sx=0,sy=0;
        const handle = modal.querySelector('#gte-titlebar');
        handle.addEventListener('mousedown', e => { if (e.target.tagName==='BUTTON') return; e.preventDefault(); sx=e.clientX; sy=e.clientY; document.addEventListener('mousemove',drag); document.addEventListener('mouseup',dragEnd); });
        function drag(e) { ox=sx-e.clientX; oy=sy-e.clientY; sx=e.clientX; sy=e.clientY; modal.style.top=Math.max(0,Math.min(window.innerHeight-50,modal.offsetTop-oy))+'px'; modal.style.left=Math.max(0,Math.min(window.innerWidth-100,modal.offsetLeft-ox))+'px'; modal.style.right='auto'; }
        function dragEnd() { document.removeEventListener('mousemove',drag); document.removeEventListener('mouseup',dragEnd); }
        return modal;
    }

    // ─── Editor Panel ────────────────────────────────────────────────
    let curOverrides = {}, curEditName = '', curBase = 'dark', livePreview = false, previewTimer = null, simpleMode = true;

    function scheduleLivePreview() {
        if (!livePreview) return; clearTimeout(previewTimer);
        previewTimer = setTimeout(async () => { const base = await getBaseStyle(curBase); if (!base) return; applyStyleToMap(buildStyle(base, curOverrides), curBase); }, 120);
    }

    // Opacity row — slider (0–100%) + eyeball hide/show. Used for pattern layers
    // (e.g. wetland tufts) where a color picker can't help; restore deletes the
    // override so the base style's own default opacity is preserved exactly.
    function teRenderOpacityRow(panel, entry) {
        const key = entry.okey; const def = (typeof entry.def === 'number') ? entry.def : 1;
        const has = curOverrides[key] != null && curOverrides[key] !== '';
        let val = has ? parseFloat(curOverrides[key]) : def; if (isNaN(val)) val = def;
        const pct = Math.round(val * 100); const isHidden = val === 0;
        const row = document.createElement('div'); row.className = 'gte-color-row';
        row.innerHTML = '<span class="gte-color-label">'+teEscHTML(entry.label)+'</span><div class="gte-color-input-wrap"><button type="button" class="gte-vis-btn '+(isHidden?'gte-layer-hidden':'')+'" title="Toggle visibility">'+(isHidden?'🚫':'👁️')+'</button><input type="range" class="gte-range" min="0" max="100" step="1" value="'+pct+'"><span class="gte-hex-display'+(isHidden?' gte-hidden-color':'')+'">'+(isHidden?'hidden':pct+'%')+'</span><button type="button" class="gte-reset-btn" title="Reset to default">↻</button></div>';
        const range = row.querySelector('.gte-range'), disp = row.querySelector('.gte-hex-display'), visBtn = row.querySelector('.gte-vis-btn'), resetBtn = row.querySelector('.gte-reset-btn');
        const refresh = (v) => { const p = Math.round(v*100); range.value = p; if (v === 0) { disp.textContent = 'hidden'; disp.classList.add('gte-hidden-color'); visBtn.textContent = '🚫'; visBtn.classList.add('gte-layer-hidden'); } else { disp.textContent = p+'%'; disp.classList.remove('gte-hidden-color'); visBtn.textContent = '👁️'; visBtn.classList.remove('gte-layer-hidden'); } };
        range.addEventListener('input', e => { const v = parseInt(e.target.value,10)/100; curOverrides[key] = v; refresh(v); scheduleLivePreview(); });
        visBtn.addEventListener('click', () => { const cur = (curOverrides[key] != null && curOverrides[key] !== '') ? parseFloat(curOverrides[key]) : def; const nv = (cur === 0) ? def : 0; curOverrides[key] = nv; refresh(nv); scheduleLivePreview(); });
        resetBtn.addEventListener('click', () => { delete curOverrides[key]; refresh(def); scheduleLivePreview(); });
        panel.appendChild(row);
    }

    // Multiplier row — slider for a global wildcard override (e.g. road width).
    function teRenderMultRow(panel, entry) {
        const key = entry.mkey; const def = (typeof entry.def === 'number') ? entry.def : 1;
        const min = (typeof entry.min === 'number') ? entry.min : 0.25, max = (typeof entry.max === 'number') ? entry.max : 3, step = (typeof entry.step === 'number') ? entry.step : 0.05;
        const has = curOverrides[key] != null && curOverrides[key] !== '';
        let val = has ? parseFloat(curOverrides[key]) : def; if (isNaN(val)) val = def;
        const row = document.createElement('div'); row.className = 'gte-color-row';
        row.innerHTML = '<span class="gte-color-label">'+teEscHTML(entry.label)+'</span><div class="gte-color-input-wrap"><input type="range" class="gte-range" min="'+min+'" max="'+max+'" step="'+step+'" value="'+val+'"><span class="gte-hex-display">'+val.toFixed(2)+'×</span><button type="button" class="gte-reset-btn" title="Reset to default">↻</button></div>';
        const range = row.querySelector('.gte-range'), disp = row.querySelector('.gte-hex-display'), resetBtn = row.querySelector('.gte-reset-btn');
        range.addEventListener('input', e => { const v = parseFloat(e.target.value); curOverrides[key] = v; disp.textContent = v.toFixed(2)+'×'; scheduleLivePreview(); });
        resetBtn.addEventListener('click', () => { delete curOverrides[key]; range.value = def; disp.textContent = def.toFixed(2)+'×'; scheduleLivePreview(); });
        panel.appendChild(row);
    }

    function renderEditor(overrides, editName, base) {
        curOverrides = overrides || {}; curEditName = editName || ''; curBase = base || 'dark';
        const panel = document.getElementById('gte-panel-editor'); panel.innerHTML = '';

        // Name + base selector
        const nameRow = document.createElement('div'); nameRow.className = 'gte-name-row';
        nameRow.innerHTML = '<input type="text" class="gte-name-input" id="gte-theme-name" placeholder="Theme name\u2026" value="'+teEscAttr(curEditName)+'" maxlength="50"><select id="gte-base-select" class="gte-name-input" style="flex:0 0 auto;width:auto;padding:6px 8px;"><option value="dark" '+(curBase==='dark'?'selected':'')+'>Dark base</option><option value="light" '+(curBase==='light'?'selected':'')+'>Light base</option></select>';
        nameRow.querySelector('#gte-base-select').addEventListener('change', e => { curBase = e.target.value; renderEditor(curOverrides, curEditName, curBase); scheduleLivePreview(); });
        panel.appendChild(nameRow);

        // Live preview
        const previewRow = document.createElement('div'); previewRow.className = 'gte-preview-row';
        previewRow.innerHTML = '<input type="checkbox" id="gte-live-preview" '+(livePreview?'checked':'')+'><label for="gte-live-preview">Live preview</label>';
        previewRow.querySelector('#gte-live-preview').addEventListener('change', e => { livePreview = e.target.checked; if (livePreview) scheduleLivePreview(); });
        panel.appendChild(previewRow);

        // Simple/Full toggle
        const modeRow = document.createElement('div'); modeRow.className = 'gte-mode-toggle';
        modeRow.innerHTML = '<span class="'+(simpleMode?'gte-mode-active':'')+'">Simple</span><button type="button" class="gte-mode-switch '+(simpleMode?'':'gte-on')+'" id="gte-mode-switch"></button><span class="'+(simpleMode?'':'gte-mode-active')+'">Full</span>';
        modeRow.querySelector('#gte-mode-switch').addEventListener('click', () => { simpleMode = !simpleMode; renderEditor(curOverrides, curEditName, curBase); });
        panel.appendChild(modeRow);

        // Color rows
        const layerGroups = simpleMode ? getSimpleLayers(curBase) : getEditableLayers(curBase);
        for (const group of layerGroups) {
            const header = document.createElement('div'); header.className = 'gte-group-header'; header.textContent = group.group; panel.appendChild(header);
            for (const entry of group.layers) {
                if (entry.kind === 'opacity') { teRenderOpacityRow(panel, entry); continue; }
                if (entry.kind === 'mult') { teRenderMultRow(panel, entry); continue; }
                const keys = entry.keys ? entry.keys : [entry.id+'::'+entry.prop];
                const firstKey = keys[0];
                const currentColor = curOverrides[firstKey] || getDefaultColor(firstKey, curBase);
                const isHidden = currentColor === 'transparent';
                const displayColor = isHidden ? getDefaultColor(firstKey, curBase) : currentColor;
                const row = document.createElement('div'); row.className = 'gte-color-row';
                row.innerHTML = '<span class="gte-color-label">'+teEscHTML(simpleMode ? entry.label : entry.label)+'</span><div class="gte-color-input-wrap"><button type="button" class="gte-vis-btn '+(isHidden?'gte-layer-hidden':'')+'" title="Toggle visibility">'+(isHidden?'\ud83d\udeab':'\ud83d\udc41\ufe0f')+'</button><span class="gte-hex-display '+(isHidden?'gte-hidden-color':'')+'">'+(isHidden?'hidden':currentColor)+'</span><input type="color" class="gte-color-input" value="'+displayColor+'" '+(isHidden?'disabled':'')+'><button type="button" class="gte-reset-btn" title="Reset to default">\u21bb</button></div>';
                const colorInput = row.querySelector('.gte-color-input'), hexDisplay = row.querySelector('.gte-hex-display'), visBtn = row.querySelector('.gte-vis-btn'), resetBtn = row.querySelector('.gte-reset-btn');
                colorInput.addEventListener('input', e => { for (const k of keys) curOverrides[k] = e.target.value; hexDisplay.textContent = e.target.value; scheduleLivePreview(); });
                visBtn.addEventListener('click', () => {
                    const nowHidden = curOverrides[firstKey] === 'transparent';
                    if (nowHidden) { const restored = colorInput.value; for (const k of keys) curOverrides[k] = restored; hexDisplay.textContent = restored; hexDisplay.classList.remove('gte-hidden-color'); colorInput.disabled = false; visBtn.textContent = '\ud83d\udc41\ufe0f'; visBtn.classList.remove('gte-layer-hidden'); }
                    else { for (const k of keys) curOverrides[k] = 'transparent'; hexDisplay.textContent = 'hidden'; hexDisplay.classList.add('gte-hidden-color'); colorInput.disabled = true; visBtn.textContent = '\ud83d\udeab'; visBtn.classList.add('gte-layer-hidden'); }
                    scheduleLivePreview();
                });
                resetBtn.addEventListener('click', () => { const def = getDefaultColor(firstKey, curBase); for (const k of keys) curOverrides[k] = def; colorInput.value = def; hexDisplay.textContent = def; hexDisplay.classList.remove('gte-hidden-color'); colorInput.disabled = false; visBtn.textContent = '\ud83d\udc41\ufe0f'; visBtn.classList.remove('gte-layer-hidden'); scheduleLivePreview(); });
                panel.appendChild(row);
            }
        }

        // Action buttons
        const btnRow = document.createElement('div'); btnRow.className = 'gte-btn-row';
        btnRow.innerHTML = '<button class="gte-btn gte-btn-primary" id="gte-save-apply">Save &amp; Apply</button><button class="gte-btn gte-btn-secondary" id="gte-load-current">Load Current</button><button class="gte-btn gte-btn-secondary" id="gte-export-json">Export JSON</button><button class="gte-btn gte-btn-secondary" id="gte-import-json-btn">Import JSON</button><input type="file" id="gte-import-json-file" accept=".json" style="display:none">';
        panel.appendChild(btnRow);

        panel.querySelector('#gte-save-apply').addEventListener('click', async () => {
            const nameInput = document.getElementById('gte-theme-name'); const name = nameInput.value.trim();
            if (!name) { nameInput.style.borderColor = '#f38ba8'; nameInput.focus(); setTimeout(() => nameInput.style.borderColor = '', 1500); return; }
            const themes = teLoadThemes(); themes[name] = { overrides: { ...curOverrides }, base: curBase, createdAt: themes[name]?.createdAt || Date.now(), updatedAt: Date.now() };
            teSaveThemes(themes); teSetActive(name); curEditName = name;
            const base = await getBaseStyle(curBase); if (!base) return;
            const style = buildStyle(base, curOverrides); applyStyleToMap(style, curBase); persistTheme(style);
            teShowToast('Theme "'+name+'" saved & applied!');
        });
        panel.querySelector('#gte-load-current').addEventListener('click', async () => {
            const map = teGetMap(); if (!map) return teShowToast('Map not ready.', true);
            const style = map.getStyle(); if (!style) return teShowToast('No style loaded.', true);
            renderEditor(readColorsFromStyle(style, curBase), curEditName, curBase); teShowToast('Loaded colors from current map.');
        });
        panel.querySelector('#gte-export-json').addEventListener('click', async () => {
            const base = await getBaseStyle(curBase); if (!base) return;
            const style = buildStyle(base, curOverrides); const name = document.getElementById('gte-theme-name').value.trim() || 'custom_theme'; style.name = name;
            const blob = new Blob([JSON.stringify(style, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name.replace(/[^a-z0-9_-]/gi, '_')+'.json'; a.click(); URL.revokeObjectURL(a.href);
        });
        panel.querySelector('#gte-import-json-btn').addEventListener('click', () => panel.querySelector('#gte-import-json-file').click());
        panel.querySelector('#gte-import-json-file').addEventListener('change', async e => {
            const file = e.target.files[0]; if (!file) return;
            try { const text = await file.text(); const style = JSON.parse(text); if (!style.layers || !Array.isArray(style.layers)) return teShowToast('Invalid theme JSON.', true);
                const overrides = readAllColorsFromStyle(style); const name = style.name || file.name.replace(/\.json$/i, '');
                const bg = overrides['background::background-color']; const detectedBase = bg ? (isColorDark(bg) ? 'dark' : 'light') : 'dark';
                renderEditor(overrides, name, detectedBase); teShowToast('Imported "'+name+'" — adjust and Save & Apply.');
            } catch { teShowToast('Failed to parse JSON file.', true); }
            e.target.value = '';
        });
    }

    // ─── Manager Panel ───────────────────────────────────────────────
    function renderManager() {
        const panel = document.getElementById('gte-panel-manager');
        const themes = teLoadThemes(); const activeTheme = teGetActive();
        const names = Object.keys(themes).sort((a, b) => {
            const pa = a === 'Default' ? 0 : a === 'Default Dark' ? 1 : 2;
            const pb = b === 'Default' ? 0 : b === 'Default Dark' ? 1 : 2;
            return pa !== pb ? pa - pb : a.localeCompare(b);
        });
        let html = '';
        if (names.length === 0) { html = '<div class="gte-empty-msg">No saved themes yet.<br>Use the Editor tab to create one!</div>'; }
        else { for (const name of names) { const theme = themes[name]; const isActive = name === activeTheme; const isBundled = theme.bundled; const isLight = (theme.base||'dark') === 'light';
            html += '<div class="gte-theme-card '+(isActive?'gte-active-theme':'')+'"><span class="gte-theme-card-name" title="'+teEscAttr(name)+'"><span class="gte-theme-name-text">'+teEscHTML(name)+(isActive?' \u2713':'')+(isBundled?' \ud83d\udccc':'')+'</span><span class="gte-theme-badge '+(isLight?'gte-theme-badge-light':'gte-theme-badge-dark')+'">'+(isLight?'Light':'Dark')+'</span></span><div class="gte-theme-card-actions"><button class="gte-btn gte-btn-primary gte-btn-sm" data-action="apply" data-name="'+teEscAttr(name)+'">Apply</button><button class="gte-btn gte-btn-secondary gte-btn-sm" data-action="edit" data-name="'+teEscAttr(name)+'">Edit</button>'+(!isBundled?'<button class="gte-btn gte-btn-danger gte-btn-sm" data-action="delete" data-name="'+teEscAttr(name)+'">Delete</button>':'<span class="gte-btn gte-btn-danger gte-btn-sm" style="opacity:0.5;cursor:not-allowed;" title="Built-in">Delete</span>')+'</div></div>'; } }
        html += '<div class="gte-io-section"><button class="gte-btn gte-btn-secondary" id="gte-restore-default" style="width:100%">Restore Default Theme</button></div>';
        panel.innerHTML = html;
        panel.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', async () => {
            const action = btn.dataset.action, name = btn.dataset.name;
            if (action === 'apply') await teApplyByName(name);
            if (action === 'edit') teEditTheme(name);
            if (action === 'delete') teDeleteTheme(name);
        }));
        const restoreBtn = panel.querySelector('#gte-restore-default');
        if (restoreBtn) restoreBtn.addEventListener('click', async () => {
            teSetActive(''); localStorage.removeItem('customTheme');
            const uc = teGetUserConfig(); if (uc) uc.theme = 'default'; localStorage.setItem('userConfig', JSON.stringify(uc));
            try { const base = await getBaseStyle('light'); if (base) { const map = teGetMap(); if (map) map.setStyle(base); } } catch {}
            renderManager(); teShowToast('Restored default theme.');
        });
    }

    async function teApplyByName(name) {
        const themes = teLoadThemes(); const theme = themes[name]; if (!theme) return;
        const base = await getBaseStyle(theme.base || 'dark'); if (!base) return;
        const style = buildStyle(base, theme.overrides); applyStyleToMap(style, theme.base || 'dark');
        teSetActive(name); persistTheme(style); renderManager(); teShowToast('Applied "'+name+'".');
    }

    function teEditTheme(name) {
        const themes = teLoadThemes(); const theme = themes[name]; if (!theme) return;
        teModal.querySelectorAll('.gte-tab').forEach(t => t.classList.remove('gte-active'));
        teModal.querySelectorAll('.gte-panel').forEach(p => p.classList.remove('gte-active'));
        teModal.querySelector('[data-panel="editor"]').classList.add('gte-active');
        teModal.querySelector('#gte-panel-editor').classList.add('gte-active');
        renderEditor(theme.overrides, name, theme.base || 'dark');
    }

    function teDeleteTheme(name) {
        const themes = teLoadThemes(); if (themes[name]?.bundled) { teShowToast('Cannot delete built-in themes.', true); return; }
        if (!confirm('Delete theme "'+name+'"?')) return;
        delete themes[name]; teSaveThemes(themes); if (teGetActive() === name) teSetActive(''); renderManager(); teShowToast('Deleted "'+name+'".');
    }

    // ─── Init ────────────────────────────────────────────────────────
    teInjectCSS();
    teModal = teBuildModal();
    renderEditor({}, '', 'dark');

    // Expose API for dropdown flyout
    _themeEditor = {
        loadThemes: teLoadThemes,
        getActiveThemeName: teGetActive,
        applyThemeByName: teApplyByName,
        toggleModal: () => {
            const isHidden = teModal.classList.contains('gte-hidden');
            if (isHidden) { teModal.classList.remove('gte-hidden'); if (!document.getElementById('gte-theme-name')) renderEditor({}, ''); }
            else teModal.classList.add('gte-hidden');
        }
    };

    // Re-apply active theme on load
    (async () => {
        let tries = 0;
        while (!teGetMap() && tries < 60) { await new Promise(r => setTimeout(r, 500)); tries++; }
        const activeName = teGetActive();
        if (activeName) {
            const themes = teLoadThemes();
            if (themes[activeName]) {
                const themeBase = themes[activeName].base || 'dark';
                const base = await getBaseStyle(themeBase);
                if (base) { const style = buildStyle(base, themes[activeName].overrides); applyStyleToMap(style, themeBase); persistTheme(style); }
            }
        }
    })();

            })();
            _featureStatus.themeEditor = 'ok';
            console.log('[GeoPixelcons++] \u2705 Theme Editor loaded');
        } catch (err) {
            _featureStatus.themeEditor = 'error';
            dbgPush(`Theme Editor init failed: ${err && err.message ? err.message : String(err)}`, { error: err, uiComponent: 'Theme Editor' });
            console.error('[GeoPixelcons++] \u274c Theme Editor failed:', err);
        }
    }