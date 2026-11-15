// English strings are their own keys; nl holds the Dutch. {name}-style placeholders get filled in.
let lang: 'en' | 'nl' = 'en';
export const setLang = (l: 'en' | 'nl') => { lang = l; document.documentElement.lang = l; };

export function t(key: string, vars: Record<string, string | number> = {}): string {
  const s = (lang === 'nl' && NL[key]) || key;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}
export function applyI18n(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n!); });
}

const NL: Record<string, string> = {
  '50+ kinds, including rar, iso, dmg, cab, msi, deb, rpm, apk, jar and split volumes.': 'Meer dan 50 soorten, waaronder rar, iso, dmg, cab, msi, deb, rpm, apk, jar en gesplitste volumes.',
  '7z, zip, tar, tar.gz, tar.bz2, tar.xz, tar.zst, tar.br, tar.lz4, wim, gz, bz2, xz, zst, br, lz4 and age.': '7z, zip, tar, tar.gz, tar.bz2, tar.xz, tar.zst, tar.br, tar.lz4, wim, gz, bz2, xz, zst, br, lz4 en age.',
  'AES-256 7z with hidden file names, AES-256 zip, and age with a passphrase or public keys.': 'AES-256 7z met verborgen bestandsnamen, AES-256 zip, en age met een wachtzin of publieke sleutels.',
  About: 'Over', 'Add files': 'Bestanden toevoegen', 'Add folder': 'Map toevoegen', 'Add some files first': 'Voeg eerst bestanden toe', 'Added in B': 'Nieuw in B',
  'Also leave out (globs)': 'Ook weglaten (patronen)', 'Also save the password as a text file': 'Bewaar het wachtwoord ook als tekstbestand', Always: 'Altijd',
  'Always compress': 'Altijd comprimeren', 'Always open as an archive': 'Altijd als archief openen', Archive: 'Archief', 'Archive A': 'Archief A', 'Archive B': 'Archief B',
  Archives: 'Archieven', 'Archives open, everything else gets compressed. Nothing is uploaded: every file stays on your device.': 'Archieven gaan open, al het andere wordt gecomprimeerd. Er wordt niets geüpload: elk bestand blijft op je apparaat.',
  Auto: 'Automatisch', Automatic: 'Automatisch', 'Browse, search and preview files in an archive, then edit or convert it.': 'Blader, zoek en bekijk bestanden in een archief, en bewerk of converteer het daarna.',
  Cancel: 'Annuleren', Cancelled: 'Geannuleerd', Changed: 'Gewijzigd', Checksum: 'Controlegetal', 'Checksum file': 'Controlebestand', Checksums: 'Controlegetallen',
  'Choose a folder': 'Kies een map', 'Choose files': 'Kies bestanden', Clear: 'Wissen', Close: 'Sluiten', 'Compare archives': 'Archieven vergelijken', Compress: 'Comprimeren',
  'Compress view': 'Naar Comprimeren', 'Compressed tarballs': 'Gecomprimeerde tarballs', Compression: 'Compressie', 'Compression (0-9)': 'Compressie (0-9)', Convert: 'Converteren',
  'Convert {name}': '{name} converteren', 'Convert…': 'Converteren…', Copied: 'Gekopieerd', Copy: 'Kopiëren', 'Could not open': 'Kon niet openen', 'Custom size…': 'Eigen grootte…',
  'Cyrillic DOS (CP866)': 'Cyrillisch DOS (CP866)', 'Cyrillic Windows (1251)': 'Cyrillisch Windows (1251)', 'DOS (CP437)': 'DOS (CP437)', Dark: 'Donker', Delete: 'Verwijderen',
  'Delete selected': 'Selectie verwijderen', Download: 'Downloaden', 'Download age-key.txt': 'age-key.txt downloaden',
  'Drop files to hash them. Paste a checksum list (sha256sum or md5sum format) to verify.': 'Sleep bestanden hierheen om ze te hashen. Plak een lijst (sha256sum- of md5sum-formaat) om te controleren.',
  'Drop files, folders or archives here': 'Sleep bestanden, mappen of archieven hierheen', 'Drop to add': 'Loslaten om toe te voegen', 'Dropping files': 'Bestanden neerzetten', Duplicates: 'Dubbelen',
  Edit: 'Bewerken', Editing: 'Bewerken', 'Encrypt file names too': 'Ook bestandsnamen versleutelen', Encryption: 'Versleuteling', Extract: 'Uitpakken', 'Extract all': 'Alles uitpakken',
  'Extract into a folder': 'Uitpakken in een map', 'Extract selected': 'Selectie uitpakken', 'Extracting {n} archives': '{n} archieven worden uitgepakt', 'Files to compress': 'Te comprimeren bestanden',
  'Files with the same size and CRC in the open archive.': 'Bestanden met dezelfde grootte en CRC in het geopende archief.', Format: 'Formaat', Generate: 'Genereren', History: 'Geschiedenis', Home: 'Start',
  In: 'In', 'Into a folder I pick': 'In een map die ik kies', 'Japanese (Shift-JIS)': 'Japans (Shift-JIS)', Job: 'Taak', Jobs: 'Taken', 'Keyboard shortcuts': 'Sneltoetsen', 'Korean (EUC-KR)': 'Koreaans (EUC-KR)',
  'Leave out .DS_Store, ._ files and __MACOSX': '.DS_Store, ._-bestanden en __MACOSX weglaten', Length: 'Lengte', Light: 'Licht', 'Loading preview…': 'Voorbeeld laden…', 'Look inside': 'Bekijk inhoud',
  Make: 'Maken', 'Make a key pair': 'Maak een sleutelpaar',
  'Make an age key pair. Share the public key; keep the secret key. Anyone can encrypt to the public key, only the secret key decrypts.': 'Maak een age-sleutelpaar. Deel de publieke sleutel, bewaar de geheime. Iedereen kan versleutelen voor de publieke sleutel, alleen de geheime sleutel ontsleutelt.',
  Modified: 'Gewijzigd', 'Move between rows': 'Tussen rijen bewegen', Name: 'Naam', Names: 'Namen', 'Names, sizes and times only. Kept in this browser.': 'Alleen namen, groottes en tijden. Bewaard in deze browser.',
  Never: 'Nooit', 'New name': 'Nieuwe naam', No: 'Nee', 'No archive open.': 'Geen archief geopend.', 'No duplicates in {name}.': 'Geen dubbelen in {name}.', 'No matches': 'Geen resultaten',
  'Not a valid name': 'Geen geldige naam', 'Nothing to save': 'Niets om op te slaan', 'Nothing yet.': 'Nog niets.', 'Nothing yet. Drop files here or use Add files.': 'Nog niets. Sleep bestanden hierheen of gebruik Bestanden toevoegen.',
  OK: 'OK', 'One archive per item': 'Eén archief per onderdeel', 'Only when the archive holds several items': 'Alleen als het archief meerdere onderdelen bevat', Open: 'Openen',
  'Open a folder or preview a file': 'Map openen of bestand bekijken', 'Open an archive': 'Open een archief', 'Open an archive first.': 'Open eerst een archief.',
  'Open archives, compress everything else': 'Archieven openen, al het andere comprimeren', 'Opening {name}…': '{name} openen…',
  'Opens 7z, zip, rar, tar, gz, bz2, xz, zst, br, lz4, age, iso, dmg, cab, msi, deb, rpm, apk, jar and 40 more.': 'Opent 7z, zip, rar, tar, gz, bz2, xz, zst, br, lz4, age, iso, dmg, cab, msi, deb, rpm, apk, jar en nog 40 meer.',
  Options: 'Opties', 'Or an age secret key (AGE-SECRET-KEY-1…)': 'Of een geheime age-sleutel (AGE-SECRET-KEY-1…)', Out: 'Uit', Packed: 'Ingepakt', Packing: 'Inpakken',
  Password: 'Wachtwoord', 'Password (optional)': 'Wachtwoord (optioneel)', 'Password for {name}': 'Wachtwoord voor {name}', Passwords: 'Wachtwoorden',
  'Pick two archives to see what was added, removed or changed between them.': 'Kies twee archieven om te zien wat er is toegevoegd, verwijderd of gewijzigd.',
  Preset: 'Voorkeur', 'Preset saved': 'Voorkeur opgeslagen', Presets: 'Voorkeuren', Protect: 'Beveiligen', 'Public key': 'Publieke sleutel', Ratio: 'Verhouding', Remove: 'Verwijderen',
  'Removed in B': 'Verwijderd in B', Rename: 'Hernoemen', Save: 'Opslaan', 'Save again': 'Opnieuw opslaan', 'Save as preset': 'Opslaan als voorkeur', 'Save as…': 'Opslaan als…',
  'Save options as a preset from the Compress view.': 'Sla opties op als voorkeur vanuit Comprimeren.', 'Save results': 'Resultaten opslaan', 'Save the changes as': 'Wijzigingen opslaan als',
  'Saved {n} files': '{n} bestanden opgeslagen', 'Search in the archive': 'Zoeken in het archief', 'Secret key': 'Geheime sleutel', Select: 'Selecteer',
  'Select a file to preview it here, without extracting the archive.': 'Selecteer een bestand om het hier te bekijken, zonder het archief uit te pakken.',
  'Select one file or folder to rename': 'Selecteer één bestand of map om te hernoemen', 'Select some files first': 'Selecteer eerst bestanden', 'Select the focused row': 'De gekozen rij selecteren',
  Settings: 'Instellingen', Show: 'Toon', 'Simplified Chinese (GBK)': 'Vereenvoudigd Chinees (GBK)', 'Single files': 'Losse bestanden', Size: 'Grootte', 'Skipped {n} unsafe paths': '{n} onveilige paden overgeslagen',
  'Solid archive (smaller, slower to change)': 'Solide archief (kleiner, trager te wijzigen)', 'Split into volumes': 'Splitsen in volumes', Symbols: 'Symbolen', Terminal: 'Terminal', Test: 'Testen',
  'Test the archive': 'Het archief testen', "This browser can't write to a folder, so the files came as one zip.": 'Deze browser kan niet naar een map schrijven, dus de bestanden komen als één zip.',
  "This browser can't write to folders (Brave and Firefox turn that off), so results download instead.": 'Deze browser kan niet naar mappen schrijven (Brave en Firefox zetten dat uit), dus resultaten worden gedownload.',
  'This folder is empty': 'Deze map is leeg', 'This help': 'Deze hulp', Time: 'Tijd', 'Too big to preview ({size}). Extract it instead.': 'Te groot voor een voorbeeld ({size}). Pak het uit.',
  Tools: 'Gereedschap', 'Traditional Chinese (Big5)': 'Traditioneel Chinees (Big5)', 'UTF-8': 'UTF-8', 'Up one folder': 'Map omhoog', 'Use ZipCrypto for old unzip tools (weak)': 'ZipCrypto voor oude uitpakprogramma\'s (zwak)',
  'Western Windows (1252)': 'West-Europees Windows (1252)', When: 'Wanneer', 'Words instead': 'Woorden', 'Wrong password, try again': 'Verkeerd wachtwoord, probeer opnieuw',
  added: 'toegevoegd', 'age key pair': 'age-sleutelpaar', 'age keys': 'age-sleutels', 'age needs a password or a public key': 'age heeft een wachtwoord of publieke sleutel nodig',
  'age public keys (optional, one per line)': 'publieke age-sleutels (optioneel, één per regel)', bits: 'bits', cancelled: 'geannuleerd', 'does not match': 'komt niet overeen', encrypted: 'versleuteld',
  fair: 'redelijk', files: 'bestanden', items: 'onderdelen', left: 'over', level: 'niveau', matches: 'klopt', new: 'nieuw', removed: 'verwijderd', renamed: 'hernoemd',
  'shown once, save it now': 'wordt maar één keer getoond, sla hem nu op', strong: 'sterk', volumes: 'volumes', waiting: 'wacht', weak: 'zwak',
  'web-pak is the browser version of pakket. It uses 7-Zip (7z-wasm), zstd, brotli, lz4, typage and hash-wasm. See NOTICE for their licences.': 'web-pak is de browserversie van pakket. Het gebruikt 7-Zip (7z-wasm), zstd, brotli, lz4, typage en hash-wasm. Zie NOTICE voor hun licenties.',
  '{n} groups of identical files; {size} could be saved.': '{n} groepen identieke bestanden; {size} kan bespaard worden.', '{n} more; search to narrow it down': 'nog {n}; zoek om te verfijnen',
  '{same} the same, {added} added, {removed} removed, {changed} changed.': '{same} gelijk, {added} toegevoegd, {removed} verwijderd, {changed} gewijzigd.',
};
