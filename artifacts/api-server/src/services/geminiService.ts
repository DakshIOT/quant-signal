import { logger } from "../lib/logger.js";

interface GeminiEnhanceParams {
  symbol: string;
  timeframe: string;
  signal: string;
  regime: string;
  confidenceScore: number;
  riskScore: number;
  strategyNote?: string;
  signalReasoning: string[];
}

export class GeminiService {
  private apiKey: string | undefined;

  constructor() {
    this.apiKey = process.env["GEMINI_API_KEY"];
  }

  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.trim().length > 0;
  }

  async enhanceExplanation(params: GeminiEnhanceParams): Promise<string | null> {
    if (!this.isConfigured()) {
      logger.info("GEMINI_API_KEY not configured — skipping AI explanation enhancement");
      return null;
    }

    try {
      const prompt = `You are a professional quantitative trading analyst. Provide a concise, clear explanation (2-3 sentences) for the following trade setup analysis result. Do NOT make specific price predictions. Be educational and risk-aware.

Setup:
- Symbol: ${params.symbol}
- Timeframe: ${params.timeframe}  
- Signal Generated: ${params.signal}
- Market Regime: ${params.regime}
- Confidence Score: ${params.confidenceScore}/100
- Risk Score: ${params.riskScore}/100
- Strategy Notes: ${params.strategyNote || "None provided"}
- Key Reasoning Points: ${params.signalReasoning.slice(0, 3).join("; ")}

Provide a plain English explanation of why this signal was generated and what traders should keep in mind. Focus on context, not prediction.`;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              maxOutputTokens: 200,
              temperature: 0.3,
            },
          }),
        },
      );

      if (!response.ok) {
        logger.warn({ status: response.status }, "Gemini API call failed");
        return null;
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      return text?.trim() || null;
    } catch (err) {
      logger.warn({ err }, "Error calling Gemini API — using fallback explanation");
      return null;
    }
  }
}

export const geminiService = new GeminiService();
