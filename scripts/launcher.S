.section .rodata
.global vibecli_script
.global vibecli_script_end
vibecli_script:
.incbin "dist/server.cjs"
vibecli_script_end:
.section .note.GNU-stack,"",@progbits
