import { HttpClient } from "./http-client.js";
import { SpotifyError } from "./error.js";
import { getHash } from "./hash-registry.js";

class SpotifyCreditsEndpoint {
    gqlClient!: HttpClient;

    constructor(gqlClient: HttpClient) {
        this.gqlClient = gqlClient;
    }

    async getTrackCredits(trackId: string) {
        const hash = await getHash("Track", "queryTrackCreditsModal");

        const res = await this.gqlClient.post("query", {
            body: {
                variables: {
                    trackUri: `spotify:track:${trackId}`,
                },
                operationName: "queryTrackCreditsModal",
                extensions: {
                    persistedQuery: {
                        version: 1,
                        sha256Hash: hash,
                    },
                },
            },
        });

        SpotifyError.mayThrow(res);
        return res.data?.trackUnion || res.data?.track || res.data?.trackV2 || res.data;
    }
}

export { SpotifyCreditsEndpoint };
