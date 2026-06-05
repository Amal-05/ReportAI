"use client";

import { useState, useRef, useEffect } from "react";
import { Sparkles, Send, X, MessageSquare, ChevronRight, ChevronLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { researchAssist } from "@/lib/api";
import type { ResearchAssistResponse } from "@/lib/types";

interface Message {
  role: "user" | "assistant";
  content: string;
  response?: ResearchAssistResponse;
}

interface ResearchAssistantProps {
  source: string;
  onApplyChange: (newText: string, action: "replace" | "insert") => void;
  selectedText: string;
  onClearSelection?: () => void;
}

export function ResearchAssistant({ source, onApplyChange, selectedText, onClearSelection }: ResearchAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await researchAssist({
        prompt: input,
        selected_text: selectedText || undefined,
        full_source: source,
      });

      const assistantMessage: Message = {
        role: "assistant",
        content: response.answer,
        response: response,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, I encountered an error. Please check your API key." },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-10 right-10 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-110"
        title="Research Assistant"
      >
        <Sparkles className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-80 flex-col border-l bg-card shadow-2xl transition-all duration-300 ease-in-out md:w-96">
      <div className="flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-accent" />
          <h2 className="font-semibold tracking-tight">Research Assistant</h2>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-3 opacity-60">
            <MessageSquare className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm">
              Select text in the editor and ask me to refine it, 
              generate a table, or check for logical flow.
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted border border-border"
              }`}
            >
              <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              {msg.response?.suggested_text && (
                <div className="mt-3 space-y-2">
                  <div className="rounded bg-background/50 p-2 font-mono text-[11px] overflow-x-auto border border-border/50">
                    {msg.response.suggested_text}
                  </div>
                  <Button
                    size="sm"
                    className="w-full text-xs h-8"
                    onClick={() => onApplyChange(msg.response!.suggested_text!, msg.response!.action as any)}
                  >
                    Apply to Editor
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-muted border border-border rounded-2xl px-4 py-3 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-xs text-muted-foreground">Analyzing...</span>
            </div>
          </div>
        )}
      </div>

      <div className="border-t p-4 bg-muted/30">
        {selectedText && (
          <div className="mb-2.5 rounded border border-primary/20 bg-primary/5 p-2 text-xs flex items-center justify-between">
            <div className="truncate flex-1 text-primary">
              <span className="font-semibold">Selected:</span> "{selectedText}"
            </div>
            {onClearSelection && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-4 w-4 ml-1 text-muted-foreground hover:text-foreground hover:bg-transparent"
                onClick={onClearSelection}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex gap-2"
        >
          <Input
            placeholder="Ask anything..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="bg-background shadow-inner"
          />
          <Button type="submit" size="icon" disabled={isLoading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
        <p className="text-[10px] text-muted-foreground mt-2 text-center italic">
          Tip: Highlight text in the editor for better results.
        </p>
      </div>
    </div>
  );
}
