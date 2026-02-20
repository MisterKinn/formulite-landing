# -*- mode: python ; coding: utf-8 -*-
# Nova AI Lite - Installer Build (onedir mode)
# Usage: pyinstaller "Nova AI Lite_installer.spec"

a = Analysis(
    ['gui_app.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('prompts', 'prompts'),
        ('templates', 'templates'),
        ('fonts', 'fonts'),
        ('.env', '.'),
        ('pabicon789.png', '.'),
        ('nova_ai.ico', '.'),
    ],
    hiddenimports=[
        'pyhwpx',
        'google.generativeai',
        'PySide6',
        'PIL',
        'requests',
        'dotenv',
        'pythoncom',
        'win32com',
        'win32com.client',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Nova AI',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='nova_ai.ico',
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='Nova AI',
)
