export class YoutubeMusicClient {
    private readonly baseUrl = 'https://music.youtube.com/youtubei/v1';
    private readonly clientName = 'WEB_REMIX';
    private readonly clientVersion = '1.20230508.00.00';

    private getContext() {
        return {
            client: {
                clientName: this.clientName,
                clientVersion: this.clientVersion,
                hl: 'en',
                gl: 'US'
            }
        };
    }

    async post(endpoint: string, body: any): Promise<any> {
        const url = `${this.baseUrl}/${endpoint}?prettyPrint=false`;
        const payload = {
            context: this.getContext(),
            ...body
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`YouTube Music API error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    }
}
