from openai import OpenAI
from app.core.config import settings

def get_openai_client_and_model(api_key: str | None = None) -> tuple[OpenAI, str]:
    """
    Returns an OpenAI client and the appropriate model name based on the provided API key.
    If no API key is provided, it uses the one from settings.
    """
    key = api_key or settings.openai_api_key
    if not key:
        raise ValueError("OpenAI API key not configured.")
        
    base_url = None
    model = settings.openai_model
    
    if key.startswith("AIzaSy"):
        base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"
        model = "gemini-2.0-flash"
    elif key.startswith("gsk_"):
        base_url = "https://api.groq.com/openai/v1"
        model = "llama-3.3-70b-versatile"
    elif key.startswith("sk-"):
        # standard OpenAI
        if model == "gpt-4.1-mini": # Fix legacy typo if it persists
            model = "gpt-4o-mini"
        
    client = OpenAI(api_key=key, base_url=base_url)
    return client, model
