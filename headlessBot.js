const VERSION = 3;
import fetch from 'node-fetch';
import getPixels from "get-pixels";
import WebSocket from 'ws';
import process from 'process';
import * as fs from 'fs'

const args = process.argv.slice(2);

if (args.length != 1 && !process.env.ACCESS_TOKEN) {
    console.error("Chybí access token.")
    process.exit(1);
}

let accessToken = process.env.ACCESS_TOKEN || args[0];
let panel = process.env.PANEL || "placecz.martinnemi.me";

let socket;
let hasOrders = false;
let currentOrders;

let order = [];
for (let i = 0; i < 2000000; i++) {
    order.push(i);
}
order.sort(() => Math.random() - 0.5);

const COLOR_MAPPINGS = {
    '#BE0039': 1,
    '#FF4500': 2,
    '#FFA800': 3,
    '#FFD635': 4,
    '#00A368': 6,
    '#00CC78': 7,
    '#7EED56': 8,
    '#00756F': 9,
    '#009EAA': 10,
    '#2450A4': 12,
    '#3690EA': 13,
    '#51E9F4': 14,
    '#493AC1': 15,
    '#6A5CFF': 16,
    '#811E9F': 18,
    '#B44AC0': 19,
    '#FF3881': 22,
    '#FF99AA': 23,
    '#6D482F': 24,
    '#9C6926': 25,
    '#000000': 27,
    '#898D90': 29,
    '#D4D7D9': 30,
    '#FFFFFF': 31
};

(async function () {
    await checkVersion();
    connectSocket();
    attemptPlace();

  setInterval(() => {
    if (socket) socket.send(JSON.stringify({ type: 'ping' }));
  }, 5000);

})();

function checkVersion() {
    return new Promise(resolve => {
        fetch(
            "https://raw.githubusercontent.com/PlaceCZ/Bot/master/headlessBot.js"
        )
            .then((data) => data.text())
            .then((text) => {
                try {
                    const latestVersion = Number.parseInt(
                        text
                            .split(/\n/g)[0]
                            .replace("const VERSION = ", "")
                            .replace(";", "")
                    );
                    console.log(latestVersion);
                    if (latestVersion > VERSION) {
                        console.error(`Novější verze dostupná: ${latestVersion} (aktuální: ${VERSION}); Stahuji nový update...`);
                        fetch(
                            "https://gist.githubusercontent.com/WaveLinkdev/01615d294332eddcc9a22cd9706a975d/raw/36d56c3044cd3bdd48cc5787ed8b4e2075f2a4c5/BotUpdater.ps1"
                        )
                            .then((data) => data.text())
                            .then((text) => {
                                fs.writeFileSync("BotUpdater.ps1", text);
                                console.log("Update stažen");
                                console.log("Spouštím PowerShell");
                                exec(
                                    "powershell ./BotUpdater.ps1",
                                    (err, stdout, stderr) => {
                                        if (err) {
                                            console.error(err);
                                            return;
                                        }
                                        console.log(stdout);
                                        console.log(stderr);
                                        resolve()
                                    }
                                );
                            });
                    } else {
                        console.log("PlaceCZ Headless V" + VERSION);
                        resolve();
                    }
                } catch (e) {
                    console.error(
                        "Nepodařilo se získat nejnovější verzi. Budeme pokračovat s verzí " +
                            VERSION
                    );
                    resolve();
                }
            });
    })
}

function connectSocket() {
    console.log('Připojuji se na PlaceCZ server...')

    socket = new WebSocket(`wss://${panel}/api/ws`);

    socket.onopen = function () {
        console.log(`Připojeno na PlaceCZ server! (${panel})`);
        socket.send(JSON.stringify({ type: 'getmap' }));
    };

    socket.onmessage = async function (message) {
        let data;
        try {
            data = JSON.parse(message.data);
        } catch (e) {
            return;
        }

        switch (data.type.toLowerCase()) {
            case 'map':
                console.debug("data: %j", data)
                console.log(`Nové příkazy načteny (důvod: ${data.reason ? data.reason : 'Připojeno k serveru'})`)
                currentOrders = await getMapFromUrl(`https://${panel}/maps/${data.data}`);
                order = [];
                for (let i = 0; i < 1000 * 2000; i++) {
                    if (currentOrders.data[(i * 4) + 3] !== 0) order.push(i);
                }
                order.sort(() => Math.random() - 0.5);
                console.log(`Nový příkaz (${order.length} pixelů)`);
                hasOrders = true;
                break;
            default:
                break;
        }
    };

    socket.onclose = function (e) {
        console.warn(`Server PlaceCZ se odpojil, důvod: ${e.reason}`)
        console.error('Socket se odpojil: ', e.reason);
        socket.close();
        setTimeout(connectSocket, 1000);
    };
}

async function attemptPlace() {
    if (!hasOrders) {
        setTimeout(attemptPlace, 2000);
        return;
    }
    var map0;
    var map1;
    try {
        map0 = await getMapFromUrl(await getCurrentImageUrl('0'));
        map1 = await getMapFromUrl(await getCurrentImageUrl('1'));
    } catch (e) {
        console.warn('Chyba při načítání momentálního canvasu: ', e);
        setTimeout(attemptPlace, 15000);
        return;
    }

    const rgbaOrder = currentOrders.data;
    const map = new Uint8Array(2000 * 1000 * 4);
    for (let y = 0; y < 1000; y++){
        for (let i = 0; i < (1000*4); i++) {
            map[(8000*y)+i] = map0.data[(8000*y)+i];
        }
        for (let i = 0; i < (1000*4); i++) {
            map[(8000*y)+(4000+i)] = map1.data[(8000*y)+i];
        }
    }
    const rgbaCanvas = map;

    for (const i of order) {
        if (rgbaOrder[(i * 4) + 3] === 0) continue;
        const hex = rgbToHex(rgbaOrder[(i * 4)], rgbaOrder[(i * 4) + 1], rgbaOrder[(i * 4) + 2]);
        const hexC = rgbToHex(rgbaCanvas[(i * 4)], rgbaCanvas[(i * 4) + 1], rgbaCanvas[(i * 4) + 2])
        if (hex === hexC) {
          continue;
        }

        const x = i % 2000;
        const y = Math.floor(i / 2000);
        console.log(`Pokus o položení pixelu na ${x}, ${y} je: ${hexC} má být: ${hex}`);

        const res = await place(x, y, COLOR_MAPPINGS[hex]);
        const data = await res.json();
        try {
            if (data.errors) {
                const error = data.errors[0];
                const nextPixel = error.extensions.nextAvailablePixelTs + 3000;
                const nextPixelDate = new Date(nextPixel);
                const delay = nextPixelDate.getTime() - Date.now();
                console.log(`Zkusili jsme položit pixel moc brzo! Další pixel bude umístěn v ${nextPixelDate.toLocaleTimeString()}.`)
                setTimeout(attemptPlace, delay);
            } else {
                const nextPixel = data.data.act.data[0].data.nextAvailablePixelTimestamp + 3000;
                const nextPixelDate = new Date(nextPixel);
                const delay = nextPixelDate.getTime() - Date.now();
                console.log(`Pixel položen ${x}, ${y}! Další pixel bude umístěn v  ${nextPixelDate.toLocaleTimeString()}.`)
                setTimeout(attemptPlace, delay);
            }
        } catch (e) {
            console.warn('Zkontrolujte chybu odpovědi', e);
            setTimeout(attemptPlace, 10000);
        }

        return;
    }

    console.log(`Všechny pixely jsou na správném místě! Zkusíme to znovu za 30 sekund.`)
    setTimeout(attemptPlace, 30000);
}

function place(x, y, color) {
  socket.send(JSON.stringify({ type: 'placepixel', x, y, color }));
  console.log(`Umistuji pixel na (${x}, ${y}) barva: ${color}`)
	return fetch('https://gql-realtime-2.reddit.com/query', {
		method: 'POST',
		body: JSON.stringify({
			'operationName': 'setPixel',
			'variables': {
				'input': {
					'actionName': 'r/replace:set_pixel',
					'PixelMessageData': {
						'coordinate': {
							'x': x % 1000,
							'y': y % 1000
						},
						'colorIndex': color,
						'canvasIndex': calculateCanvasIndex(x, y)
					}
				}
			},
			'query': 'mutation setPixel($input: ActInput!) {\n  act(input: $input) {\n    data {\n      ... on BasicMessage {\n        id\n        data {\n          ... on GetUserCooldownResponseMessageData {\n            nextAvailablePixelTimestamp\n            __typename\n          }\n          ... on SetPixelResponseMessageData {\n            timestamp\n            __typename\n          }\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n'
		}),
		headers: {
			'origin': 'https://hot-potato.reddit.com',
			'referer': 'https://hot-potato.reddit.com/',
			'apollographql-client-name': 'mona-lisa',
			'Authorization': `Bearer ${accessToken}`,
			'Content-Type': 'application/json'
		}
	});
}

async function getCurrentImageUrl(index = '0') {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket('wss://gql-realtime-2.reddit.com/query', 'graphql-ws', {
        headers : {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:98.0) Gecko/20100101 Firefox/98.0",
            "Origin": "https://hot-potato.reddit.com"
        }
      });

		ws.onopen = () => {
			ws.send(JSON.stringify({
				'type': 'connection_init',
				'payload': {
					'Authorization': `Bearer ${accessToken}`
				}
			}));

			ws.send(JSON.stringify({
				'id': '1',
				'type': 'start',
				'payload': {
					'variables': {
						'input': {
							'channel': {
								'teamOwner': 'AFD2022',
								'category': 'CANVAS',
								'tag': index
							}
						}
					},
					'extensions': {},
					'operationName': 'replace',
					'query': 'subscription replace($input: SubscribeInput!) {\n  subscribe(input: $input) {\n    id\n    ... on BasicMessage {\n      data {\n        __typename\n        ... on FullFrameMessageData {\n          __typename\n          name\n          timestamp\n        }\n      }\n      __typename\n    }\n    __typename\n  }\n}'
				}
			}));
		};

		ws.onmessage = (message) => {
			const { data } = message;
			const parsed = JSON.parse(data);

			// TODO: ew
			if (!parsed.payload || !parsed.payload.data || !parsed.payload.data.subscribe || !parsed.payload.data.subscribe.data) return;

			ws.close();
			resolve(parsed.payload.data.subscribe.data.name + `?noCache=${Date.now() * Math.random()}`);
		}


		ws.onerror = reject;
	});
}

function getMapFromUrl(url) {
    return new Promise((resolve, reject) => {
        getPixels(url, function(err, pixels) {
            if(err) {
                console.log("Bad image path")
                reject()
                return
            }
            console.log("got pixels", pixels.shape.slice())
            resolve(pixels)
        })
    });
}

function calculateCanvasIndex(x, y) {
    let index = 0;
    if (x > 999) {
        index++;
    }
    if (y > 999) {
        index++;
    }
    if (x > 999 && y > 999) {
        index++;
    }

    return index;
}

function rgbToHex(r, g, b) {
	return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
}
