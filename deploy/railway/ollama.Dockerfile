FROM ollama/ollama:0.33.3
ENV OLLAMA_HOST=[::]:11434 \
    OLLAMA_MODELS=/models \
    OLLAMA_NO_CLOUD=1 \
    OLLAMA_NUM_PARALLEL=1 \
    OLLAMA_MAX_LOADED_MODELS=1 \
    OLLAMA_MAX_QUEUE=8 \
    OLLAMA_DEBUG_LOG_REQUESTS=false \
    OLLAMA_FLASH_ATTENTION=1 \
    OLLAMA_KV_CACHE_TYPE=q8_0 \
    LLAMA_ARG_CACHE_RAM=256 \
    OLLAMA_CONTEXT_LENGTH=16384
# No EXPOSE, public domain or pull at startup. Attach a persistent /models volume.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["ollama", "list"]
ENTRYPOINT ["/bin/ollama"]
CMD ["serve"]
