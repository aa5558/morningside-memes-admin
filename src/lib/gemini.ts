const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-latest";

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  modelVersion?: string;
  error?: { message?: string };
};

// Gemini's free tier often answers 503 ("high demand") or 429 for a few
// seconds; retry those twice with a short backoff before giving up.
async function fetchWithRetry(url: string, init: RequestInit) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, init);
    if (attempt >= 2 || (response.status !== 503 && response.status !== 429)) return response;
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
  }
}

// Sends an image plus a text prompt to Gemini and returns the captions it
// writes. Uses structured output so the response is always a JSON array.
export async function generateCaptionsWithGemini({
  image,
  mimeType,
  prompt,
}: {
  image: ArrayBuffer;
  mimeType: string;
  prompt: string;
}): Promise<{ captions: string[]; model: string }> {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set.");
  }

  const response = await fetchWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: mimeType,
                  data: Buffer.from(image).toString("base64"),
                },
              },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 1,
          responseMimeType: "application/json",
          responseSchema: { type: "ARRAY", items: { type: "STRING" } },
        },
      }),
    }
  );

  const body = (await response.json()) as GeminiResponse;

  if (!response.ok) {
    throw new Error(body.error?.message ?? `Gemini returned ${response.status}`);
  }

  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini returned no captions.");
  }

  const parsed: unknown = JSON.parse(text);
  const captions = (Array.isArray(parsed) ? parsed : [])
    .filter((caption): caption is string => typeof caption === "string")
    .map((caption) => caption.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 4);

  if (captions.length === 0) {
    throw new Error("Gemini returned no captions.");
  }

  return { captions, model: body.modelVersion ?? GEMINI_MODEL };
}

const GEMINI_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image";

type GeminiImageResponse = {
  candidates?: {
    content?: {
      parts?: { text?: string; inlineData?: { mimeType?: string; data?: string } }[];
    };
  }[];
  modelVersion?: string;
  error?: { message?: string };
};

// Thrown when the Gemini project can't generate images at all (e.g. the
// free tier has no image quota), as opposed to a one-off failure.
export class ImageGenerationUnavailableError extends Error {}

// Generates a photo from a text prompt with Gemini's image model.
export async function generateImageWithGemini(
  prompt: string
): Promise<{ image: ArrayBuffer; mimeType: string; model: string }> {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set.");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Create a realistic, candid, phone-camera-style photo of: ${prompt}. Square framing. No text, captions, or watermarks in the image.`,
              },
            ],
          },
        ],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    }
  );

  const body = (await response.json()) as GeminiImageResponse;

  if (response.status === 429 || response.status === 403 || response.status === 404) {
    throw new ImageGenerationUnavailableError(
      body.error?.message ?? `Gemini returned ${response.status}`
    );
  }
  if (!response.ok) {
    throw new Error(body.error?.message ?? `Gemini returned ${response.status}`);
  }

  const part = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) {
    throw new Error("Gemini returned no image.");
  }

  const bytes = Buffer.from(part.inlineData.data, "base64");
  return {
    image: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    mimeType: part.inlineData.mimeType ?? "image/png",
    model: body.modelVersion ?? GEMINI_IMAGE_MODEL,
  };
}
