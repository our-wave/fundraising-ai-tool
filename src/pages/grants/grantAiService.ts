/**
 * Grant AI Service
 * Generates grant content with Gemini through Firebase AI Logic (Gemini Developer API backend).
 * Requests are authenticated with the app's Firebase config, so no separate Gemini API key is needed.
 *
 * Provision Firebase application in the Firebase console
 * <ol>
 * <li>Open AI Logic and click "Get started".</li>
 * <li>Choose the Gemini Developer API provider and enable it.</li>
 * </ol>
 */

import { firebaseClient } from "@digitalaidseattle/firebase";
import { getAI, getGenerativeModel, GoogleAIBackend, Part, Schema } from "firebase/ai";
import { GrantContext } from "../../types";
import { SettingsService } from "../../services/settingsService";

export type AiResponse = {
    text: string;
    usageMetadata?: { totalTokenCount: number };
};

class GrantAiService {

    static DEFAULT_MODEL = "gemini-flash-latest";
    static instance: GrantAiService;

    static getInstance() {
        if (!GrantAiService.instance) {
            GrantAiService.instance = new GrantAiService();
        }
        return GrantAiService.instance;
    }

    private ai = getAI(firebaseClient, { backend: new GoogleAIBackend() });
    private models: string[] = [];

    constructor() {
        SettingsService.getInstance()
            .getSettings()
            .then(settings => this.models = settings.models ?? [])
    }

    /**
     * Runs a basic text generation request.
     * This is for prompts where we just want the model to return a text response.
     */
    async query(prompt: string, modelType?: string, contexts?: GrantContext[]): Promise<AiResponse> {
        const parts = await this.createParts(contexts ?? []);
        const result = await getGenerativeModel(this.ai, { model: modelType ?? this.getDefaultModel() })
            .generateContent([prompt, ...parts]);
        return {
            text: result.response.text(),
            usageMetadata: result.response.usageMetadata
        };
    }

    async createParts(contexts: GrantContext[]): Promise<Part[]> {
        return Promise.all(contexts.map(async gc => {
            if (gc.type === 'text') {
                return { text: gc.value! } as Part;
            }
            if (!gc.file && !gc.fileUrl) {
                throw new Error(`File "${gc.name}" has not been uploaded`);
            }
            // The Gemini Developer API only accepts file contents inline, not by URL
            const blob: Blob = gc.file ?? await fetch(gc.fileUrl!).then(res => res.blob());
            return this.toInlinePart(blob, gc.type);
        }));
    }

    private async toInlinePart(blob: Blob, mimeType: string): Promise<Part> {
        const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
        return { inlineData: { mimeType, data: dataUrl.split(',')[1] } };
    }

    createSchema(schemaParams: string[]): Schema {
        return Schema.object({
            properties: Object.fromEntries(
                schemaParams.map(field => [field, Schema.string()])
            )
        });
    }
    /**
     * Sends a prompt to the AI and tells it which fields to return.
     * 
     * You give it a list of field names (like ["Summary", "Budget"]),
     * and the AI will return a JSON object with those fields filled in.
     */
    async parameterizedQuery(
        prompt: string,
        schemaParams: string[],
        modelType?: string,
        contexts?: GrantContext[],
    ): Promise<AiResponse> {
        const parts = await this.createParts(contexts ?? []);
        const model = getGenerativeModel(this.ai, {
            model: modelType ?? this.getDefaultModel(),
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: this.createSchema(schemaParams),
            },
        });
        const result = await model.generateContent([prompt, ...parts]);
        return {
            text: result.response.text(),
            usageMetadata: result.response.usageMetadata
        };
    }

    async calcTokenCount(model: string, content: string): Promise<number> {
        return getGenerativeModel(this.ai, { model })
            .countTokens(["Count tokens for this document", content])
            .then(response => response.totalTokens ?? 0);
    }

    async calcFileTokenCount(model: string, file: File): Promise<number | null> {
        try {
            const part = await this.toInlinePart(file, file.type);
            const response = await getGenerativeModel(this.ai, { model })
                .countTokens(["Count tokens for this document", part]);
            return response.totalTokens ?? 0;
        } catch (err) {
            console.error("Error calculating token count for file", err);
            return null;
        }
    }

    getModels() {
        return this.models;
    }

    getDefaultModel() {
        return this.models.length === 0 ? GrantAiService.DEFAULT_MODEL : this.models[0];
    }

}

export { GrantAiService };
