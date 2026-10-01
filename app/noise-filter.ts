export const NOISE_FILTER_STORAGE_KEY = "saytosee:noise-filter";

let supportPromise: Promise<boolean> | null = null;

/**
 * Резолвится true, если в этом браузере доступен AI-шумодав Krisp.
 * Модуль весит несколько мегабайт, поэтому грузим его лениво и кешируем
 * результат — предзагрузку стоит запускать заранее (например, на лендинге).
 */
export function krispSupport(): Promise<boolean> {
  if (!supportPromise) {
    supportPromise = import("@livekit/krisp-noise-filter")
      .then((module) => module.isKrispNoiseFilterSupported())
      .catch(() => false);
  }
  return supportPromise;
}
