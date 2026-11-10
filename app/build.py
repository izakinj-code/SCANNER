# Builds app/ScannerApp.html from src/
import pathlib
s = pathlib.Path(__file__).parent / 'src'
r = lambda n: (s / n).read_text(encoding='utf-8')
ui = r('ui.js').replace('/*__EXT__ ui_ext*/', r('ui_ext.js')).replace('/*__EXT__ ui_scan*/', r('ui_scan.js'))
t = r('template.html').replace('/*__ENGINE__*/', r('engine.js')).replace('/*__SCAN__*/', r('scan.js')).replace('/*__UI__*/', ui)
(pathlib.Path(__file__).parent / 'ScannerApp.html').write_text(t, encoding='utf-8')
print('built ScannerApp.html')
