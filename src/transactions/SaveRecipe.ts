/**
 *  CreateRecipe.ts
 *
 *  @copyright 2024 Digital Aid Seattle
 *
 */

import { authService, storageService } from "../App";
import { grantRecipeService } from "../services/grantRecipeService";
import { GrantContext, GrantRecipe } from "../types";

const GLOUD_FOLDER = import.meta.env.VITE_FIREBASE_STORAGE_FOLDER;

async function organizeContextsFiles(recipe: GrantRecipe): Promise<GrantContext[]> {
    // get existing files
    const cloudFiles = await storageService
        .list(`${GLOUD_FOLDER}/${recipe.id}`)
        .then((files: any[]) => files.map((file: any) => file.name));

    const updatedContexts = await Promise.all(recipe.contexts.map(async (context): Promise<GrantContext | null> => {
        if (context.type === 'text') {
            return context;
        } else if (context.file! instanceof File) {
            // Existing files will be overwritten
            const index = cloudFiles.indexOf(context.file!.name);
            if (index > -1) {  // keep the file being overwritten
                cloudFiles.splice(index, 1);
            }
            const url = await storageService.upload(`${GLOUD_FOLDER}/${recipe.id}/${context.file!.name}`, context.file!);
            const newContext = { ...context, fileUrl: url };
            delete newContext.file;
            return newContext;
        } else {
            const index = cloudFiles.indexOf(context.name);
            if (index > -1) {  // remove from cloudFiles list
                cloudFiles.splice(index, 1);
                return context;
            } else {
                console.error('not in the cloud & no file to upload', context);
                return null;
            }
        }
    }));

    // remove unwanted files
    await Promise.all(cloudFiles.map(fileName =>
        storageService.removeFile(`${GLOUD_FOLDER}/${recipe.id}/${fileName}`)
    ));
    return updatedContexts.filter((context): context is GrantContext => context !== null);
}

export async function saveRecipe(recipe: GrantRecipe): Promise<GrantRecipe> {
    return authService.getUser()
        .then((async user => {
            const prompt = await grantRecipeService.generatePromptWithInputs(recipe);
            const contexts = await organizeContextsFiles(recipe);

            const newRecipe = {
                ...recipe,
                contexts: contexts,
                prompt: prompt
            }

            if (recipe.id) {
                return grantRecipeService.update(recipe.id, newRecipe, user);
            } else {
                return grantRecipeService.insert(newRecipe, user);
            }
        }))
}

