import { useState, useCallback, useRef } from "react";
import { formatPlace, locationSearchParams, type PlaceAddress } from "@/lib/location-search";

export interface LocationResult {
  display_name: string;
  place_id: number;
  lat: string;
  lon: string;
  address?: PlaceAddress;
}

interface UseLocationSearchOptions {
  debounceMs?: number;
  limit?: number;
  /**
   * ISO 3166-1 alpha-2. Searches this country first and the whole world when
   * it has no match. Omitted: the whole world.
   */
  countryCode?: string;
  /** The app's language: the names in the results come back in it. */
  language?: string;
}

export function useLocationSearch(options: UseLocationSearchOptions = {}) {
  const { debounceMs = 300, limit = 5, countryCode, language = "en" } = options;

  const [results, setResults] = useState<LocationResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const abortController = useRef<AbortController | null>(null);

  const search = useCallback(
    (query: string) => {
      // Clear previous timer
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }

      // Cancel previous request
      if (abortController.current) {
        abortController.current.abort();
      }

      // Clear results if query is too short
      if (query.length < 3) {
        setResults([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      debounceTimer.current = setTimeout(async () => {
        const controller = new AbortController();
        abortController.current = controller;

        const searchIn = async (country: string | undefined): Promise<LocationResult[]> => {
          const params = locationSearchParams({ query, limit, countryCode: country, language });
          const response = await fetch(
            `https://nominatim.openstreetmap.org/search?${params}`,
            {
              signal: controller.signal,
              headers: {
                "User-Agent": "FamilyCalendar/1.0",
              },
            }
          );

          if (!response.ok) {
            throw new Error("Search failed");
          }

          return (await response.json()) as LocationResult[];
        };

        try {
          let data = await searchIn(countryCode);
          // Nothing in the family's own country: an event can be anywhere, so look everywhere.
          if (countryCode && data.length === 0) data = await searchIn(undefined);
          setResults(data);
          setError(null);
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") {
            // Ignore abort errors
            return;
          }
          setError("Location search failed");
          setResults([]);
        } finally {
          setIsLoading(false);
        }
      }, debounceMs);
    },
    [debounceMs, limit, countryCode, language]
  );

  const clear = useCallback(() => {
    setResults([]);
    setError(null);
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    if (abortController.current) {
      abortController.current.abort();
    }
  }, []);

  // A result as one short line, written the way its own country writes an address
  const formatLocation = useCallback(
    (location: LocationResult): string => formatPlace(location.address, location.display_name),
    [],
  );

  return {
    results,
    isLoading,
    error,
    search,
    clear,
    formatLocation,
  };
}
