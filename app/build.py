# Builds app/ScannerApp.html from src/ (engine + ui + ui_ext + template)
import pathlib
s = pathlib.Path(__file__).parent / 'src'
ui = (s / 'ui.js').read_text(encoding='utf-8').replace('/*__EXT__ ui_ext*/', (s / 'ui_ext.js').read_text(encoding='utf-8'))
t = (s / 'template.html').read_text(encoding='utf-8').replace('v2.0', 'v4.1').replace('/*__ENGINE__*/', (s / 'engine.js').read_text(encoding='utf-8')).replace('/*__UI__*/', ui)
(pathlib.Path(__file__).parent / 'ScannerApp.html').write_text(t, encoding='utf-8')
print('built ScannerApp.html')
