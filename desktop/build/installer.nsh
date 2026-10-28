; Windows cannot remove a directory that is the uninstaller's current working directory.
; Keep registry and shortcut cleanup in electron-builder's standard uninstaller.
!macro customUnInit
  SetOutPath "$TEMP"
!macroend
