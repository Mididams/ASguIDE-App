import {
  SIGNED_URL_TTL_SECONDS,
  STORAGE_BUCKET,
  supabaseClient
} from "./config.js";

function sanitizeFileName(fileName) {
  return String(fileName ?? "document")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
}

function getExternalUrl(resource) {
  const candidateKeys = ["external_url", "url", "link", "href", "document_url"];

  for (const key of candidateKeys) {
    const value = resource?.[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

export function buildStoragePath({ categoryId, fileName, userId }) {
  const safeName = sanitizeFileName(fileName);
  const timestamp = Date.now();
  const randomPart = Math.random().toString(36).slice(2, 10);

  return `${String(categoryId)}/${String(userId)}/${timestamp}-${randomPart}-${safeName}`;
}

export async function uploadFileToStorage({ file, categoryId, userId }) {
  const storagePath = buildStoragePath({
    categoryId,
    fileName: file.name,
    userId
  });

  const { error } = await supabaseClient.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "application/octet-stream"
    });

  if (error) {
    throw error;
  }

  return {
    filePath: storagePath,
    fileName: file.name,
    mimeType: file.type || null,
    fileSize: file.size || null
  };
}

export async function deleteFileFromStorage(filePath) {
  if (!filePath) {
    return;
  }

  const { error } = await supabaseClient.storage
    .from(STORAGE_BUCKET)
    .remove([filePath]);

  if (error) {
    throw error;
  }
}

export async function insertResource(resourcePayload) {
  const { data, error } = await supabaseClient
    .from("resources")
    .insert(resourcePayload)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function updateResource(resourceId, resourcePayload) {
  const { data, error } = await supabaseClient
    .from("resources")
    .update(resourcePayload)
    .eq("id", resourceId)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function deleteResource(resourceId) {
  const { error } = await supabaseClient
    .from("resources")
    .delete()
    .eq("id", resourceId);

  if (error) {
    throw error;
  }
}

export async function createOpenDocumentUrl(resource) {
  if (!resource) {
    throw new Error("Document introuvable.");
  }

  const externalUrl = getExternalUrl(resource);

  if (externalUrl) {
    return externalUrl;
  }

  if (!resource.file_path) {
    return "";
  }

  const { data, error } = await supabaseClient.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(resource.file_path, SIGNED_URL_TTL_SECONDS);

  if (error) {
    throw error;
  }

  return data?.signedUrl ?? "";
}

export function getResourceOpenMode(resource) {
  if (getExternalUrl(resource)) {
    return "external";
  }

  if (resource?.file_path) {
    return "signed";
  }

  return "none";
}
