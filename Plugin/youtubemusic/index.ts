import { YoutubeMusicClient } from './client.js';
import { YoutubeMusicSearch } from './search.js';

export class YoutubeMusicApi {
    private client: YoutubeMusicClient;
    public search: YoutubeMusicSearch;

    constructor() {
        this.client = new YoutubeMusicClient();
        this.search = new YoutubeMusicSearch(this.client);
    }
}
