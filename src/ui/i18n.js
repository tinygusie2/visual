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
