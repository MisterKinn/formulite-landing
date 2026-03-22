import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface BoundingBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export interface DetectedRegion {
  type: 'problem' | 'image' | 'choices';
  box: BoundingBox;
}

export async function detectRegions(base64Image: string, mimeType: string): Promise<DetectedRegion[]> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          inlineData: {
            data: base64Image,
            mimeType: mimeType,
          }
        },
        "Analyze this Korean CSAT (Suneung) exam paper image. Identify the bounding boxes for: 1. The main problem text (type: 'problem'). 2. Any diagrams, graphs, or pictures (type: 'image'). 3. The multiple-choice options at the bottom (type: 'choices'). Return a JSON array of objects. Each object MUST have 'type' (strictly one of 'problem', 'image', or 'choices') and 'box' (an object with 'ymin', 'xmin', 'ymax', 'xmax'). The coordinates MUST be normalized between 0 and 1000, where (0,0) is top-left and (1000,1000) is bottom-right."
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              type: {
                type: Type.STRING,
                enum: ['problem', 'image', 'choices']
              },
              box: {
                type: Type.OBJECT,
                properties: {
                  ymin: { type: Type.NUMBER },
                  xmin: { type: Type.NUMBER },
                  ymax: { type: Type.NUMBER },
                  xmax: { type: Type.NUMBER }
                },
                required: ['ymin', 'xmin', 'ymax', 'xmax']
              }
            },
            required: ['type', 'box']
          }
        }
      }
    });

    const text = response.text;
    if (text) {
      return JSON.parse(text) as DetectedRegion[];
    }
  } catch (error) {
    console.error("Gemini API error:", error);
    throw error;
  }
  return [];
}
