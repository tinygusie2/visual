// Interface languages. The code is written with English text; t() looks it up in the table of the current language.
// {0}, {1} in a text are filled in from the arguments. Adding a language = adding a table and an entry in `languages`.

export const languages = { en: 'English', nl: 'Nederlands' };

const nl = {
  // start screen
  'New design': 'Nieuw ontwerp', 'Open file': 'Bestand openen', 'Recent': 'Recent', 'No recent designs yet': 'Nog geen recente ontwerpen',
  'File not found': 'Bestand niet gevonden', 'Remove from list': 'Uit de lijst halen', 'Choose a starting point': 'Kies een begin',
  'Back': 'Terug', 'Create': 'Maken', 'Custom size': 'Eigen formaat', 'Width': 'Breedte', 'Height': 'Hoogte',
  'Blank': 'Leeg', 'Desktop': 'Desktop', 'Phone': 'Telefoon', 'Tablet': 'Tablet', 'Presentation': 'Presentatie', 'Poster': 'Poster',
  'Social post': 'Social post', 'Story': 'Story', 'YouTube thumbnail': 'YouTube-thumbnail', 'Infinite canvas': 'Oneindig canvas',
  // menu
  'New': 'Nieuw', 'Open…': 'Openen…', 'Save': 'Opslaan', 'Save as…': 'Opslaan als…', 'Close design': 'Ontwerp sluiten',
  'Show in folder': 'Tonen in map', 'Undo': 'Ongedaan maken', 'Redo': 'Opnieuw', 'Developer tools': 'Ontwikkelaarstools',
  'Full screen': 'Volledig scherm', 'Quit': 'Afsluiten', 'Keyboard shortcuts': 'Sneltoetsen', 'Rename design': 'Ontwerp hernoemen',
  'Zoom in': 'Inzoomen', 'Zoom out': 'Uitzoomen', 'Zoom to 100%': 'Zoom naar 100%', 'Zoom to fit': 'Alles in beeld', 'Zoom to selection': 'Selectie in beeld',
  'Untitled': 'Naamloos', 'Unsaved changes': 'Niet-opgeslagen wijzigingen',
  // tools
  'Move': 'Verplaatsen', 'Frame': 'Frame', 'Rectangle': 'Rechthoek', 'Ellipse': 'Ellips', 'Text': 'Tekst',
  // panels
  'Pages': 'Pagina’s', 'Layers': 'Lagen', 'Add page': 'Pagina toevoegen', 'Delete page': 'Pagina verwijderen', 'Page {0}': 'Pagina {0}',
  'No layers yet. Pick a tool below or press F, R, O or T.': 'Nog geen lagen. Kies hieronder een tool of druk op F, R, O of T.',
  'Hide': 'Verbergen', 'Show': 'Tonen', 'Lock': 'Vergrendelen', 'Unlock': 'Ontgrendelen',
  'Page': 'Pagina', 'Background': 'Achtergrond', 'Frame presets': 'Frame-formaten', '{0} layers': '{0} lagen',
  'Position': 'Positie', 'Appearance': 'Uiterlijk', 'Opacity': 'Dekking', 'Corner radius': 'Hoekradius', 'Fill': 'Vulling',
  'Clip content': 'Inhoud afsnijden', 'Size preset': 'Formaat', 'Choose…': 'Kiezen…', 'Mixed': 'Gemengd',
  'Typography': 'Typografie', 'Font': 'Lettertype', 'Weight': 'Dikte', 'Size': 'Grootte', 'Line height': 'Regelhoogte',
  'Letter spacing': 'Letterafstand', 'Align left': 'Links uitlijnen', 'Align center': 'Centreren', 'Align right': 'Rechts uitlijnen',
  'Auto width': 'Automatische breedte', 'Auto height': 'Automatische hoogte', 'Fixed size': 'Vaste grootte',
  'Type a sum: 200 + 32, or /2 on the current value. Drag the label to change it.': 'Typ een som: 200 + 32, of /2 op de huidige waarde. Sleep het label om te wijzigen.',
  'Thin': 'Dun', 'Extra light': 'Extra licht', 'Light': 'Licht', 'Regular': 'Normaal', 'Medium': 'Medium', 'Semibold': 'Halfvet',
  'Bold': 'Vet', 'Extra bold': 'Extra vet', 'Black': 'Zwart',
  // step 2
  'Stroke': 'Rand', 'Effects': 'Effecten', 'Export': 'Exporteren', 'Group': 'Groep',
  'Add fill': 'Vulling toevoegen', 'Add stroke': 'Rand toevoegen', 'Add effect': 'Effect toevoegen', 'Add export': 'Export toevoegen',
  'Remove': 'Verwijderen', 'Mixed. Click + to replace.': 'Gemengd. Klik op + om te vervangen.',
  'Solid': 'Effen', 'Linear': 'Lineair', 'Radial': 'Radiaal', 'Inside': 'Binnen', 'Center': 'Midden', 'Outside': 'Buiten',
  'Stroke width': 'Randdikte', 'Drop shadow': 'Slagschaduw', 'Inner shadow': 'Binnenschaduw', 'Layer blur': 'Laagvervaging',
  'Background blur': 'Achtergrondvervaging', 'Blur': 'Vervaging', 'Spread': 'Spreiding',
  'Export {0}': '{0} exporteren', 'Export {0} layers': '{0} lagen exporteren', 'Export to folder': 'Exporteren naar map',
  'Exported {0} files to {1}': '{0} bestanden geëxporteerd naar {1}', 'Export failed: {0}': 'Exporteren mislukt: {0}',
  'Copied as SVG': 'Gekopieerd als SVG', 'Copied as PNG': 'Gekopieerd als PNG',
  'Align horizontal centers': 'Horizontaal centreren', 'Align top': 'Boven uitlijnen', 'Align vertical centers': 'Verticaal centreren',
  'Align bottom': 'Onder uitlijnen', 'Distribute horizontally': 'Horizontaal verdelen', 'Distribute vertically': 'Verticaal verdelen',
  'Tidy up': 'Opruimen', 'Angle': 'Hoek', 'Reverse': 'Omkeren', 'Remove stop': 'Kleurstop verwijderen',
  'Pick a colour from the screen': 'Kleur van het scherm pakken', 'Document colours': 'Kleuren in dit ontwerp', 'Recent colours': 'Recente kleuren',
  'Copy': 'Kopiëren', 'Paste': 'Plakken', 'Group selection': 'Selectie groeperen', 'Frame selection': 'Frame om selectie',
  'Ungroup': 'Groep opheffen', 'Bring to front': 'Naar voorgrond', 'Bring forward': 'Naar voren', 'Send backward': 'Naar achteren',
  'Send to back': 'Naar achtergrond', 'Copy as PNG': 'Kopiëren als PNG', 'Copy as SVG': 'Kopiëren als SVG', 'Export…': 'Exporteren…',
  'Group / ungroup': 'Groeperen / opheffen', 'Align': 'Uitlijnen', 'Place without snapping': 'Plaatsen zonder snappen',
  'Measure distances': 'Afstanden meten', 'Ctrl + drag': 'Ctrl + slepen', 'Alt + hover': 'Alt + aanwijzen',
  // step 3
  'Vector': 'Vector', 'Auto layout': 'Auto layout', 'Add auto layout': 'Auto layout toevoegen', 'Remove auto layout': 'Auto layout verwijderen',
  'Horizontal': 'Horizontaal', 'Vertical': 'Verticaal', 'Gap between layers': 'Ruimte tussen lagen', 'Padding left and right': 'Marge links en rechts',
  'Padding top and bottom': 'Marge boven en onder', 'Alignment': 'Uitlijning', 'Space between': 'Ruimte ertussen verdelen',
  'Fixed': 'Vast', 'Hug': 'Passend', 'Ignore auto layout': 'Auto layout negeren', 'Constraints': 'Vastzetten',
  'Left': 'Links', 'Right': 'Rechts', 'Left and right': 'Links en rechts', 'Top': 'Boven', 'Bottom': 'Onder', 'Top and bottom': 'Boven en onder', 'Scale': 'Schalen',
  'Fit': 'Passend', 'Stretch': 'Uitrekken', 'Tile': 'Tegels', 'Add image': 'Afbeelding toevoegen', 'Choose image': 'Afbeelding kiezen',
  'Place image or SVG…': 'Afbeelding of SVG plaatsen…', 'Could not place {0}: {1}': 'Kon {0} niet plaatsen: {1}',
  '{0} is not an image or SVG file': '{0} is geen afbeelding of SVG-bestand', 'Add / remove auto layout': 'Auto layout toevoegen / verwijderen',
  'Recovered after an unexpected close': 'Hersteld na onverwacht afsluiten', 'Restore': 'Herstellen', 'Discard': 'Weggooien', 'Never saved': 'Nooit opgeslagen',
  'Restored “{0}”. Save it to keep it.': '“{0}” hersteld. Sla het op om het te bewaren.',
  // step 4
  'Component': 'Component', 'Components': 'Componenten', 'Instance': 'Instance', 'Assets': 'Assets',
  'Create component': 'Component maken', 'Create instance': 'Instance maken', 'Select instances': 'Instances selecteren',
  '{0} instance on this page': '{0} instance op deze pagina', '{0} instances on this page': '{0} instances op deze pagina',
  'Reset changes': 'Wijzigingen terugzetten', 'Reset': 'Terugzetten', 'No changes': 'Geen wijzigingen', 'Main component': 'Hoofdcomponent',
  'Go to main component': 'Naar hoofdcomponent', 'Detach': 'Loskoppelen', 'Detach instance': 'Instance loskoppelen',
  'Part of instance “{0}”. Position and size come from the main component.': 'Onderdeel van instance “{0}”. Positie en grootte komen van het hoofdcomponent.',
  'Main component is missing': 'Hoofdcomponent ontbreekt', 'Swap for another component': 'Wisselen voor een ander component',
  'Colour variables': 'Kleurvariabelen', 'Colour variable': 'Kleurvariabele', 'Save as colour variable': 'Opslaan als kleurvariabele',
  'Detach variable': 'Variabele loskoppelen', 'New colour variable': 'Nieuwe kleurvariabele', 'Colour {0}': 'Kleur {0}',
  'Delete variable': 'Variabele verwijderen', 'Edit colour': 'Kleur wijzigen', 'Used {0} times': '{0} keer gebruikt',
  'Click to use as the fill of the selection': 'Klik om als vulling van de selectie te gebruiken',
  'Select a frame and press Ctrl+Alt+K to make it a component.': 'Selecteer een frame en druk op Ctrl+Alt+K om er een component van te maken.',
  'No colour variables yet. Click + or save a colour in the colour picker.': 'Nog geen kleurvariabelen. Klik op + of sla een kleur op in de kleurkiezer.',
  'Images': 'Afbeeldingen', 'Images you place show up here.': 'Afbeeldingen die je plaatst verschijnen hier.', 'Search assets': 'Assets zoeken',
  'Click to add an instance, or drag it onto the canvas': 'Klik om een instance toe te voegen, of sleep hem naar het canvas',
  'Duplicate a component: a new instance': 'Component dupliceren: een nieuwe instance', 'Ctrl+D / Alt + drag': 'Ctrl+D / Alt + slepen',
  'Double-click': 'Dubbelklikken', 'Go into an instance': 'Een instance in gaan', 'Layers / assets': 'Lagen / assets',
  // files and messages
  'Save changes to “{0}”?': 'Wijzigingen in “{0}” opslaan?', 'Your changes are lost if you don’t save them.': 'Je wijzigingen gaan verloren als je ze niet opslaat.',
  'Don’t save': 'Niet opslaan', 'Cancel': 'Annuleren', 'Saved': 'Opgeslagen', 'Could not open {0}: {1}': 'Kon {0} niet openen: {1}',
  'Could not save: {0}': 'Opslaan mislukt: {0}',
  // shortcuts help
  'Tools': 'Tools', 'Canvas': 'Canvas', 'Editing': 'Bewerken', 'Pan': 'Pannen', 'Zoom': 'Zoomen',
  'Space + drag, middle mouse or scroll': 'Spatie + slepen, middelste muisknop of scrollen', 'Ctrl + scroll': 'Ctrl + scrollen',
  'Duplicate': 'Dupliceren', 'Delete': 'Verwijderen', 'Select all': 'Alles selecteren', 'Nudge (Shift = 10 px)': 'Verschuiven (Shift = 10 px)',
  'Copy / paste': 'Kopiëren / plakken', 'Bring forward / send backward': 'Naar voren / naar achteren', 'Select parent': 'Bovenliggende laag selecteren',
  'Select the layer inside / edit text': 'Laag erin selecteren / tekst bewerken', 'Keep proportions while resizing': 'Verhoudingen behouden bij schalen',
  'Resize from the center': 'Schalen vanuit het midden', 'Duplicate while dragging': 'Dupliceren tijdens slepen', 'Select the deepest layer': 'Diepste laag selecteren',
  'Hide / lock': 'Verbergen / vergrendelen', 'Close': 'Sluiten'
};

const tables = { en: {}, nl };
export let lang = (navigator.language || 'en').toLowerCase().startsWith('nl') ? 'nl' : 'en';
try { const saved = localStorage.getItem('visual.lang'); if (tables[saved]) lang = saved; } catch {}

export function t(text, ...args) {
  return (tables[lang][text] ?? text).replace(/\{(\d)\}/g, (_, i) => args[i] ?? '');
}
