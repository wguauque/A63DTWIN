const materialList = [ 'BBSG 0/14', 'BBSG', 'BBSG 0/10 R50', 'GNT', 'GNT 0/31.5', 'GB', 'GB 0/14 R50', 'GB 014 OPTIBASE', 'SB', 'GTLH', 'geotextile classe 7', 'BBTM 0/10', 'BBTM 0/10 R20', 'EME2 0/14R30', 'BBME3 R30', 'BBDr 0/10', 'BB 0/6 acc', 'BB Accoustiq', 'BBME 0/10R15', 'BBME 0/10 R30', 'EME 0/14 R30', 'BBME', 'TAB BET', 'CBX C30/37', 'CBX C25/30', 'Etanch', 'Autres' ];
const companyList = [ 'COLAS SO', 'GIE A63', 'GIE-COLAS SO', 'GPT  COLAS-MALLET-SIORAT', 'LAFITTE TP', 'PRESTATAIRE PREMIER GER' ];
const prList = [];
for (let i = 34; i <= 140; i++) { prList.push(i.toString()); }
const allowedProperties = ['TYPECOUCH', 'SURFACE', 'ENTREPRISE', 'PR1', 'NORDRE', 'CHANTIER', 'FOND', 'PR2', 'DATEMS'];

let myTileset, prLocationsTileset, defaultStyle, neutralStyle, viewer, photorealisticTileset, defaultImageryLayer;
let selectedFeature = undefined;
let originalColor = new Cesium.Color();
const highlightColor = Cesium.Color.AQUA;

let isMeasuring = false;
let isClipping = false;
let isInInspectionMode = false;
let measurementDataSource, clippingDataSource, measurementHandler, clippingHandler;

let originalMinZoom = 100.0;
let originalGlobeShow = true;
let originalSse = 16; 

const appState = { materialFilter: '', entrepriseFilter: '', prSearch: '', currentPrIndex: -1, isDateViewActive: false, isMaterialViewActive: false };

function getMaterialColor(material) { const upperMaterial = material.toUpperCase(); if (upperMaterial.includes('BBSG') || upperMaterial.includes('BBTM') || upperMaterial.includes('BBME') || upperMaterial.includes('EME') || upperMaterial.includes('BBDR') || upperMaterial.includes('ACCOUSTIQ') || upperMaterial.includes('ACC')) { return Cesium.Color.DARKSLATEGRAY.toCssColorString(); } if (upperMaterial.includes('GB') || upperMaterial.includes('GNT')) { return Cesium.Color.GRAY.toCssColorString(); } if (upperMaterial.includes('SB') || upperMaterial.includes('GTLH') || upperMaterial.includes('FORME')) { return Cesium.Color.BURLYWOOD.toCssColorString(); } if (upperMaterial.includes('BET') || upperMaterial.includes('CBX')) { return Cesium.Color.LIGHTGRAY.toCssColorString(); } if (upperMaterial.includes('GEOTEXTILE')) { return Cesium.Color.WHITESMOKE.toCssColorString(); } if (upperMaterial.includes('ETANCH')) { return Cesium.Color.STEELBLUE.toCssColorString(); } return Cesium.Color.DIMGRAY.toCssColorString(); }

function applyDateStyle() { if (!myTileset) return; appState.isDateViewActive = true; myTileset.style = new Cesium.Cesium3DTileStyle({ color: { conditions: [ ["regExp('^202').test(String(${excelLayerInfoDATEMS}))", "color('green')"], ["regExp('^201').test(String(${excelLayerInfoDATEMS}))", "color('lime')"], ["regExp('^200').test(String(${excelLayerInfoDATEMS}))", "color('yellow')"], ["regExp('^19').test(String(${excelLayerInfoDATEMS}))", "color('red')"], ["true", "color('gray')"] ] } }); }

function updateTilesetStyle() {
    if (appState.isDateViewActive) { applyDateStyle(); return; }
    if (!myTileset || !defaultStyle) return;

    let showConditions = [];
    if (appState.materialFilter) { showConditions.push(`\${name_1} === '${appState.materialFilter}'`); }
    if (appState.entrepriseFilter) { showConditions.push(`\${excelLayerInfoENTREPRISE} === '${appState.entrepriseFilter}'`); }
    const showExpression = showConditions.length > 0 ? showConditions.join(' && ') : 'true';

    let finalConditions = [];
    const baseConditions = appState.isMaterialViewActive ? defaultStyle.color.conditions : neutralStyle.color.conditions;

    if (appState.prSearch) {
        const prCondition = `round(Number(\${excelLayerInfoPR1}) / 1000) === ${Number(appState.prSearch)}`;
        finalConditions.push([prCondition, "color('magenta')"]);
    }
    
    finalConditions = finalConditions.concat(baseConditions);
    myTileset.style = new Cesium.Cesium3DTileStyle({ show: showExpression, color: { conditions: finalConditions } });
}

async function zoomToFeature(prValue) {
    if (!prLocationsTileset || !viewer || !prValue) return;
    const prNumber = Number(prValue);
    if (isNaN(prNumber)) return;

    const zoomStyle = new Cesium.Cesium3DTileStyle({ show: `Number(\${dataLayer}) === ${prNumber * 1000}` });
    prLocationsTileset.style = zoomStyle;

    try {
        await viewer.zoomTo(prLocationsTileset, new Cesium.HeadingPitchRange(0.0, Cesium.Math.toRadians(-75), 500));
    } catch (error) {
        console.error("Error during zoomTo PR location operation:", error);
        alert("Could not zoom to the selected PR marker. The location data may not exist.");
    } finally {
        prLocationsTileset.style = undefined; 
        updateTilesetStyle();
    }
}

function enterInspectionMode() {
    if (isInInspectionMode) return;
    isInInspectionMode = true;
    document.getElementById('mode-title').textContent = 'Inspection Mode';
    document.getElementById('mode-title').style.display = 'block';
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 1.0;
    viewer.scene.globe.show = false;
    myTileset.maximumScreenSpaceError = 2;
}

function exitInspectionMode() {
    if (!isInInspectionMode) return;
    isInInspectionMode = false;
    document.getElementById('mode-title').style.display = 'none';
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = originalMinZoom;
    viewer.scene.globe.show = originalGlobeShow;
    myTileset.maximumScreenSpaceError = originalSse;
}

function updateActiveToolButton(activeButtonId) {
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active-tool'));
    if (activeButtonId) {
        document.getElementById(activeButtonId).classList.add('active-tool');
    }
}

async function main() {
    const loadingOverlay = document.getElementById('loadingOverlay');
    try {
        Cesium.Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJjOWE1NDNmOC02MzkxLTQyMWUtODFiOC1iYzMwZTZkMjg0OTUiLCJpZCI6MjgzODIyLCJpYXQiOjE3NTcxMjM2OTN9.SLvGBcu3zALbkrbRqQZS4KRrn960cXEbpW-7xWIavCY";
        viewer = new Cesium.Viewer("cesiumContainer", { timeline: false, animation: false, sceneModePicker: false, baseLayer: false, geocoder: true, creditContainer: document.createElement("div"), infoBox: false, selectionIndicator: false, requestRenderMode: true, maximumRenderTimeChange: Infinity });
        viewer.scene.globe.enableLighting = true;
        viewer.scene.fog.enabled = true;
        viewer.scene.fog.density = 0.0002;
        originalMinZoom = viewer.scene.screenSpaceCameraController.minimumZoomDistance;
        originalGlobeShow = viewer.scene.globe.show;
        
        defaultImageryLayer = viewer.scene.imageryLayers.addImageryProvider(await Cesium.createWorldImageryAsync());
        
        loadingOverlay.querySelector('h1').textContent = "Loading Basemap...";
        try { photorealisticTileset = await Cesium.createGooglePhotorealistic3DTileset(); photorealisticTileset.dynamicScreenSpaceError = true; photorealisticTileset.dynamicScreenSpaceErrorDensity = 0.00278; photorealisticTileset.dynamicScreenSpaceErrorFactor = 4.0; viewer.scene.primitives.add(photorealisticTileset); photorealisticTileset.show = false; } catch (error) { console.error("Could not load Google Photorealistic 3D Tiles:", error); document.getElementById('basemap-picker').disabled = true; }

        loadingOverlay.querySelector('h1').textContent = "Loading Terrain...";
        viewer.terrainProvider = await Cesium.CesiumTerrainProvider.fromIonAssetId(3693677);

        loadingOverlay.querySelector('h1').textContent = "Loading 3D Model...";
        myTileset = await Cesium.Cesium3DTileset.fromIonAssetId(3694449);
        viewer.scene.primitives.add(myTileset);
        await myTileset.readyPromise;
        
        loadingOverlay.querySelector('h1').textContent = "Loading PR Locations...";
        prLocationsTileset = await Cesium.Cesium3DTileset.fromIonAssetId(3694630);
        viewer.scene.primitives.add(prLocationsTileset);
        await prLocationsTileset.readyPromise;

        originalSse = myTileset.maximumScreenSpaceError;

        const heightOffset = 50.0;
        const cartographic = Cesium.Cartographic.fromCartesian(myTileset.boundingSphere.center);
        const surface = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0.0);
        const offset = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, heightOffset);
        const translation = Cesium.Cartesian3.subtract(offset, surface, new Cesium.Cartesian3());
        myTileset.modelMatrix = Cesium.Matrix4.fromTranslation(translation);
        prLocationsTileset.modelMatrix = Cesium.Matrix4.fromTranslation(translation);

        const colorConditions = materialList.map((material) => [`\${name_1} === '${material}'`, `color('${getMaterialColor(material)}')`]);
        colorConditions.push([true, "color('white')"]);
        
        defaultStyle = new Cesium.Cesium3DTileStyle({ show: true, color: { conditions: colorConditions } });
        neutralStyle = new Cesium.Cesium3DTileStyle({ show: true, color: { conditions: [["true", "color('gainsboro')"]] } });
        
        myTileset.style = neutralStyle;

        myTileset.clippingPolygons = new Cesium.ClippingPolygonCollection({ edgeWidth: 2.5, edgeColor: Cesium.Color.CYAN, inverse: true, });
        measurementDataSource = new Cesium.CustomDataSource('measurementDataSource');
        viewer.dataSources.add(measurementDataSource);
        clippingDataSource = new Cesium.CustomDataSource('clippingDataSource');
        viewer.dataSources.add(clippingDataSource);

        buildMaterialFilterUI(); buildEntrepriseFilterUI(); setupEventListeners();

        loadingOverlay.querySelector('h1').textContent = "Positioning Camera...";
        await viewer.zoomTo(myTileset);
        loadingOverlay.style.opacity = '0';
        setTimeout(() => { loadingOverlay.style.display = 'none'; }, 500);
    } catch (error) { console.error("Critical error during Cesium setup:", error); loadingOverlay.querySelector('h1').textContent = `Application Error: ${error.message || 'Asset loading failed. Please check token and network.'}`; }
}

function buildMaterialFilterUI() { const select = document.getElementById('material-filter'); select.innerHTML = ''; const allOption = document.createElement('option'); allOption.value = ''; allOption.textContent = 'Filter by All Materials'; select.appendChild(allOption); materialList.forEach(material => { const option = document.createElement('option'); option.value = material; option.textContent = material; select.appendChild(option); }); }
function buildEntrepriseFilterUI() { const select = document.getElementById('entreprise-filter'); select.innerHTML = ''; const allOption = document.createElement('option'); allOption.value = ''; allOption.textContent = 'Show All Companies'; select.appendChild(allOption); companyList.forEach(company => { const option = document.createElement('option'); option.value = company; option.textContent = company; select.appendChild(option); }); }

function navigateToPr(pr) { exitInspectionMode(); deactivateDateView(); const prSearchInput = document.getElementById('pr-search'); prSearchInput.value = pr; document.getElementById('autocomplete-results').innerHTML = ''; appState.prSearch = pr; appState.currentPrIndex = prList.indexOf(pr); updateTilesetStyle(); zoomToFeature(pr); }

function displayFeatureInfo(feature) { const infobox = document.getElementById('infobox'); const propertyIds = feature.getPropertyIds(); let content = '<h3>Selected Feature</h3><table>'; for (let i = 0; i < propertyIds.length; i++) { const propName = propertyIds[i]; const displayName = propName.replace('excelLayerInfo', ''); if (allowedProperties.includes(displayName.toUpperCase())) { let propValue = feature.getProperty(propName); if (displayName.toUpperCase() === 'DATEMS' && propValue) { propValue = propValue.split(' ')[0]; } propValue = (propValue === null || propValue === undefined) ? "N/A" : propValue; content += `<tr><th>${displayName}</th><td>${propValue}</td></tr>`; } } content += '</table>'; infobox.innerHTML = content; infobox.style.display = 'block'; }

function activateMeasurement() { isMeasuring = true; updateActiveToolButton('measure-btn'); measurementHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas); let positions = []; let totalDistance = 0; let dynamicLine, distanceLabel; const getPositionOnModel = (screenPosition) => { const pickedObject = viewer.scene.pick(screenPosition); if (Cesium.defined(pickedObject) && (pickedObject.primitive === myTileset || pickedObject.tileset === myTileset)) { return viewer.scene.pickPosition(screenPosition); } return null; }; measurementHandler.setInputAction(function (movement) { if (positions.length === 0) return; const cartesian = getPositionOnModel(movement.endPosition); if (!Cesium.defined(cartesian)) return; if (!Cesium.defined(dynamicLine)) { dynamicLine = measurementDataSource.entities.add({ polyline: { positions: new Cesium.CallbackProperty(() => [positions[positions.length - 1], cartesian], false), width: 2, material: Cesium.Color.YELLOW } }); } const segmentDistance = Cesium.Cartesian3.distance(positions[positions.length - 1], cartesian); distanceLabel.position = cartesian; distanceLabel.label.text = `Total: ${(totalDistance + segmentDistance).toFixed(2)} m`; }, Cesium.ScreenSpaceEventType.MOUSE_MOVE); measurementHandler.setInputAction(function (click) { const cartesian = getPositionOnModel(click.position); if (!Cesium.defined(cartesian)) return; positions.push(cartesian); if (positions.length > 1) { const lastPoint = positions[positions.length - 2]; totalDistance += Cesium.Cartesian3.distance(lastPoint, cartesian); measurementDataSource.entities.add({ polyline: { positions: [lastPoint, cartesian], width: 3, material: Cesium.Color.ORANGERED } }); } measurementDataSource.entities.add({ position: cartesian, point: { pixelSize: 8, color: Cesium.Color.ORANGERED } }); if (!Cesium.defined(distanceLabel)) { distanceLabel = measurementDataSource.entities.add({ position: cartesian, label: { text: 'Start measuring', font: '14pt monospace', style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineWidth: 2, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -9) } }); } }, Cesium.ScreenSpaceEventType.LEFT_CLICK); measurementHandler.setInputAction(() => deactivateMeasurement(), Cesium.ScreenSpaceEventType.RIGHT_CLICK); }
function deactivateMeasurement() { isMeasuring = false; updateActiveToolButton(null); if (Cesium.defined(measurementHandler)) { measurementHandler.destroy(); measurementHandler = undefined; } measurementDataSource.entities.removeAll(); }

function activateClippingTool() { isClipping = true; updateActiveToolButton('clip-btn'); enterInspectionMode(); clippingHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas); let points = []; let polygonEntity = null; const getPositionOnModel = (screenPosition) => { const pickedObject = viewer.scene.pick(screenPosition); if (Cesium.defined(pickedObject) && (pickedObject.primitive === myTileset || pickedObject.tileset === myTileset)) { return viewer.scene.pickPosition(screenPosition); } return null; }; clippingHandler.setInputAction(function(click) { const cartesian = getPositionOnModel(click.position); if (Cesium.defined(cartesian)) { points.push(cartesian); clippingDataSource.entities.add({ position: cartesian, point: { pixelSize: 8, color: Cesium.Color.WHITE } }); } }, Cesium.ScreenSpaceEventType.LEFT_CLICK); clippingHandler.setInputAction(function(movement) { if (points.length < 1) return; const cartesian = getPositionOnModel(movement.endPosition); if (Cesium.defined(cartesian)) { if (polygonEntity === null) { polygonEntity = clippingDataSource.entities.add({ polygon: { hierarchy: new Cesium.CallbackProperty(() => new Cesium.PolygonHierarchy(points.concat(cartesian)), false), material: Cesium.Color.WHITE.withAlpha(0.3), outline: true, outlineColor: Cesium.Color.WHITE } }); } } }, Cesium.ScreenSpaceEventType.MOUSE_MOVE); clippingHandler.setInputAction(function() { if (points.length >= 3) { const newClippingPolygon = new Cesium.ClippingPolygon({ positions: points }); myTileset.clippingPolygons.add(newClippingPolygon); const boundingSphere = Cesium.BoundingSphere.fromPoints(points); viewer.camera.flyToBoundingSphere(boundingSphere, { duration: 1.5, offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-60), boundingSphere.radius * 3.0) }); } deactivateClippingTool(false); }, Cesium.ScreenSpaceEventType.RIGHT_CLICK); }
function deactivateClippingTool(fullReset = true) { isClipping = false; if (clippingHandler) { clippingHandler.destroy(); clippingHandler = undefined; } clippingDataSource.entities.removeAll(); if (fullReset) { exitInspectionMode(); updateActiveToolButton(null); deactivateDateView(); } }
function clearClippingPlanes() { if (myTileset && myTileset.clippingPolygons) { myTileset.clippingPolygons.removeAll(); } deactivateClippingTool(true); }

function deactivateDateView() { appState.isDateViewActive = false; document.getElementById('date-ramp-banner').style.display = 'none'; updateTilesetStyle(); }

function setupEventListeners() {
    const measureBtn = document.getElementById('measure-btn');
    const showDateRampBtn = document.getElementById('show-date-ramp-btn');
    const applyDateRampBtn = document.getElementById('apply-date-ramp-btn');
    const closeDateRampBtn = document.getElementById('close-date-ramp-btn');
    const clipBtn = document.getElementById('clip-btn');
    const clearClipsBtn = document.getElementById('clear-clips-btn');
    const selectionHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    const selectFeatureAction = function (movement) { if (isMeasuring || isClipping) return; if (Cesium.defined(selectedFeature)) { selectedFeature.color = originalColor; selectedFeature = undefined; } const pickedFeature = viewer.scene.pick(movement.position); const infobox = document.getElementById('infobox'); if (pickedFeature instanceof Cesium.Cesium3DTileFeature && pickedFeature.tileset === myTileset) { selectedFeature = pickedFeature; Cesium.Color.clone(selectedFeature.color, originalColor); selectedFeature.color = highlightColor; displayFeatureInfo(pickedFeature); } else { infobox.style.display = 'none'; } };
    selectionHandler.setInputAction(selectFeatureAction, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    measureBtn.addEventListener('click', () => { if (isMeasuring) { deactivateMeasurement(); } else { clearClippingPlanes(); activateMeasurement(); } });
    showDateRampBtn.addEventListener('click', () => { document.getElementById('date-ramp-banner').style.display = 'flex'; });
    applyDateRampBtn.addEventListener('click', () => { clearClippingPlanes(); applyDateStyle(); });
    closeDateRampBtn.addEventListener('click', () => { deactivateDateView(); });

    clipBtn.addEventListener('click', () => { if (isClipping) { clearClippingPlanes(); } else { deactivateMeasurement(); applyDateStyle(); document.getElementById('date-ramp-banner').style.display = 'flex'; activateClippingTool(); } });
    clearClipsBtn.addEventListener('click', clearClippingPlanes);

    document.getElementById('basemap-picker').addEventListener('change', (event) => { const selectedBasemap = event.target.value; if (selectedBasemap === 'photorealistic') { if(photorealisticTileset) photorealisticTileset.show = true; defaultImageryLayer.show = false; viewer.scene.globe.baseColor = Cesium.Color.BLACK; } else { if(photorealisticTileset) photorealisticTileset.show = false; defaultImageryLayer.show = true; viewer.scene.globe.baseColor = Cesium.Color.TRANSPARENT; } });
    document.getElementById('pr-search').addEventListener('input', () => { exitInspectionMode(); deactivateDateView(); const value = document.getElementById('pr-search').value.toLowerCase(); const autocompleteResults = document.getElementById('autocomplete-results'); autocompleteResults.innerHTML = ''; if (!value) { appState.prSearch = ''; updateTilesetStyle(); return; } const filteredPRs = prList.filter(pr => pr.toLowerCase().startsWith(value)); filteredPRs.forEach(pr => { const item = document.createElement('div'); item.className = 'autocomplete-item'; item.textContent = pr; item.addEventListener('click', () => navigateToPr(pr)); autocompleteResults.appendChild(item); }); });
    document.getElementById('prev-pr-btn').addEventListener('click', () => { if (appState.currentPrIndex > 0) { navigateToPr(prList[appState.currentPrIndex - 1]); } });
    document.getElementById('next-pr-btn').addEventListener('click', () => { if (appState.currentPrIndex < prList.length - 1) { navigateToPr(prList[appState.currentPrIndex + 1]); } });
    
    document.getElementById('material-filter').addEventListener('change', () => { exitInspectionMode(); deactivateDateView(); appState.materialFilter = document.getElementById('material-filter').value; updateTilesetStyle(); });
    document.getElementById('entreprise-filter').addEventListener('change', () => { exitInspectionMode(); deactivateDateView(); appState.entrepriseFilter = document.getElementById('entreprise-filter').value; updateTilesetStyle(); });
    
    document.getElementById('colorize-btn').addEventListener('click', () => {
        deactivateDateView();
        appState.isMaterialViewActive = !appState.isMaterialViewActive;
        document.getElementById('colorize-btn').classList.toggle('active-tool', appState.isMaterialViewActive);
        updateTilesetStyle();
    });

    document.getElementById('reset-btn').addEventListener('click', () => {
        document.getElementById('material-filter').value = '';
        document.getElementById('entreprise-filter').value = '';
        document.getElementById('pr-search').value = '';
        document.getElementById('autocomplete-results').innerHTML = '';
        appState.materialFilter = '';
        appState.entrepriseFilter = '';
        appState.prSearch = '';
        appState.currentPrIndex = -1;
        appState.isMaterialViewActive = false;
        document.getElementById('colorize-btn').classList.remove('active-tool');

        clearClippingPlanes();
        
        viewer.zoomTo(myTileset);
    });
}

main();
