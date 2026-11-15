# Changelog

## 0.1.0 (2026-11-15)

First version: pakket's feature set in the browser, and more.

- Create 17 formats (7z, zip, tar, tar.gz, tar.bz2, tar.xz, tar.zst, tar.br, tar.lz4, wim, gz, bz2, xz, zst, br, lz4, age) with levels, solid 7z, split volumes and presets, one archive per item, leaving out Mac files and globs, checksum files and a password file.
- Open 50+ kinds of archive and split volume sets; zst, br, lz4 and age layers are peeled off first, and a tar inside is unpacked in the same step.
- AES-256 7z with hidden names, AES-256 or ZipCrypto zip, age with a passphrase or public keys, age key pairs.
- Archive browser: folder tree, sortable table, search, size by file type, previews of images, video, audio, PDF, text and code with highlighting, markdown and hex, without extracting.
- Extract all or selected files, into a folder (Chromium) or as downloads; smart folders; unsafe paths refused; names in old zips decoded (CP437, Shift-JIS, GBK, Big5, EUC-KR, CP866, 1251, 1252).
- Edit archives (add, rename, remove) and convert between formats.
- Tools: checksums with list verification, compare two archives, duplicates, a password generator with strength meter.
- Job queue in workers with progress, speed, time left and cancel; history; four themes; English and Dutch; keyboard shortcuts; installable, works offline, opens archives from the OS and from the share menu.
