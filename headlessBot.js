const VERSION = 5;
import fetch from "node-fetch";
import getPixels from "get-pixels";
import WebSocket from "ws";
import process from "process";
import { login } from "./autoLogin.js";

const args = process.argv.slice(2);

let accessTokens;

if (args.length !== 1 && !process.env.ACCESS_TOKEN) {
    console.error("Chybí access token.");
    process.exit(1);
} else if (args[0] === "autologin") {
    accessTokens = await login();
} else {
    accessTokens = (process.env.ACCESS_TOKEN || args[0]).split(",");
}

let defaultAccessToken = accessTokens[0];

if (accessTokens.length > 4)
    console.warn("Více než 4 tokeny na IP adresu není doporučeno.");

const PANEL = process.env.PANEL || "placecz.martinnemi.me";

let socket;
let currentOrders;
let currentOrderList;

const COLOR_MAPPINGS = {
    '#6D001A': 0,
    '#BE0039': 1,
    '#FF4500': 2,
    '#FFA800': 3,
    '#FFD635': 4,
    '#FFF8B8': 5,
    '#00A368': 6,
    '#00CC78': 7,
    '#7EED56': 8,
    '#00756F': 9,
    '#009EAA': 10,
    '#00CCC0': 11,
    '#2450A4': 12,
    '#3690EA': 13,
    '#51E9F4': 14,
    '#493AC1': 15,
    '#6A5CFF': 16,
    '#94B3FF': 17,
    '#811E9F': 18,
    '#B44AC0': 19,
    '#E4ABFF': 20,
    '#DE107F': 21,
    '#FF3881': 22,
    '#FF99AA': 23,
    '#6D482F': 24,
    '#9C6926': 25,
    '#FFB470': 26,
    '#000000': 27,
    '#515252': 28,
    '#898D90': 29,
    '#D4D7D9': 30,
    '#FFFFFF': 31
};

let rgbaJoin = (a1, a2, rowSize = 1000, cellSize = 4) => {
    const rawRowSize = rowSize * cellSize;
    const rows = a1.length / rawRowSize;
    let result = new Uint8Array(a1.length + a2.length);
    for (var row = 0; row < rows; row++) {
        result.set(
            a1.slice(rawRowSize * row, rawRowSize * (row + 1)),
            rawRowSize * 2 * row
        );
        result.set(
            a2.slice(rawRowSize * row, rawRowSize * (row + 1)),
            rawRowSize * (2 * row + 1)
        );
    }
    return result;
};

let getRealWork = (rgbaOrder) => {
    let order = [];
    for (let i = 0; i < 2000000; i++) {
        if (rgbaOrder[i * 4 + 3] !== 0) {
            order.push(i);
        }
    }
    return order;
};

let getPendingWork = (work, rgbaOrder, rgbaCanvas) => {
    let pendingWork = [];
    for (const i of work) {
        if (rgbaOrderToHex(i, rgbaOrder) !== rgbaOrderToHex(i, rgbaCanvas)) {
            pendingWork.push(i);
        }
    }
    return pendingWork;
};

(async function () {
    await checkVersion();
    connectSocket();
    const interval = 300 / accessTokens.length;
    let delay = 0;
    for (const accessToken of accessTokens) {
        setTimeout(() => attemptPlace(accessToken), delay * 1000);
        delay += interval;
    }

    setInterval(() => {
        if (socket) socket.send(JSON.stringify({ type: "ping" }));
    }, 5000);
})();

function checkVersion() {
    return new Promise((resolve) => {
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
                        console.error(`Novější verze dostupná: ${latestVersion} (aktuální: ${VERSION})\nStáhněte novou verzi z https://github.com/PlaceCZ/Bot`);
                        resolve();
                    } else {
                        console.log(`PlaceCZ Headless V${VERSION}`);
                        resolve();
                    }
                } catch (e) {
                    console.error(`Nepodařilo se získat nejnovější verzi. Budeme pokračovat s verzí ${VERSION}`);
                    resolve();
                }
            });
    });
}

function connectSocket() {
    console.log("Připojuji se na PlaceCZ server...");

    socket = new WebSocket(`wss://${PANEL}/api/ws`);

    socket.onopen = function () {
        console.log(`Připojeno na PlaceCZ server! (${PANEL})`);
        socket.send(JSON.stringify({ type: "getmap" }));
        socket.send(
            JSON.stringify({
                type: "brand",
                brand: `headlessV${VERSION}`,
            })
        );
    };

    socket.onmessage = async function (message) {
        let data;
        try {
            data = JSON.parse(message.data);
        } catch (e) {
            return;
        }

        switch (data.type.toLowerCase()) {
            case "map":
                console.debug("data: %j", data);
                console.log(`Nové příkazy načteny (důvod: ${data.reason ? data.reason : "Připojeno k serveru"})`);
                currentOrders = await getMapFromUrl(`https://${PANEL}/maps/${data.data}`);
                const order = [];
                for (let i = 0; i < 1000 * 2000; i++) {
                    if (currentOrders.data[i * 4 + 3] !== 0) order.push(i);
                }
                order.sort(() => Math.random() - 0.5);
                console.log(`Nový příkaz (${order.length}) pixelů)`);
                currentOrderList = getRealWork(currentOrders.data);
                break;
            default:
                break;
        }
    };

    socket.onclose = function (e) {
        console.warn(`Server PlaceCZ se odpojil, důvod: ${e.reason}`);
        console.error("Socket se odpojil: ", e.reason);
        socket.close();
        setTimeout(connectSocket, 1000);
    };
}

async function attemptPlace(accessToken = defaultAccessToken) {
    let retry = () => attemptPlace(accessToken);
    if (currentOrderList === undefined) {
        setTimeout(retry, 2000); // probeer opnieuw in 2sec.
        return;
    }
    const maps = [];
    try {
        for (let i = 0; i < 2; i++) {
            maps.push(await getMapFromUrl(await getCurrentImageUrl(i.toString())));
        }
    } catch (e) {
        console.warn("Chyba pri nacitani mapy: ", e);
        setTimeout(retry, 15000); // probeer opnieuw in 15sec.
        return;
    }

    const rgbaOrder = currentOrders.data;
    const rgbaCanvas = rgbaJoin(maps[0].data, maps[1].data);
    const work = getPendingWork(currentOrderList, rgbaOrder, rgbaCanvas);

    if (work.length === 0) {
        console.log("Vsechny pixely na spravnem miste, zkusime znovu za 30 sec...");
        setTimeout(retry, 30000); // probeer opnieuw in 30sec.
        return;
    }
    const percentComplete =
        100 - Math.ceil((work.length * 100) / currentOrderList.length);
    const idx = Math.floor(Math.random() * work.length);
    const i = work[idx];
    const x = i % 2000;
    const y = Math.floor(i / 2000);
    const hex = rgbaOrderToHex(i, rgbaOrder);

    console.log(`Pokousim se umistit pixel na  ${x}, ${y}... (${percentComplete}% hotovo)`);

    const res = await place(x, y, COLOR_MAPPINGS[hex], accessToken);
    const data = await res.json();
    try {
        if (data.errors) {
            const error = data.errors[0];
            const nextPixel = error.extensions.nextAvailablePixelTs + 3000;
            const nextPixelDate = new Date(nextPixel);
            const delay = nextPixelDate.getTime() - Date.now();
            console.log(`Pixel umisten prilis brzy, dalsi pixel bude umisten v  ${nextPixelDate.toLocaleTimeString()}.`);
            setTimeout(retry, delay);
        } else {
            const nextPixel =
                data.data.act.data[0].data.nextAvailablePixelTimestamp + 3000;
            const nextPixelDate = new Date(nextPixel);
            const delay = nextPixelDate.getTime() - Date.now();
            console.log(`Pixel umisten na ${x}, ${y}! Dalsi pixel bude umisten v ${nextPixelDate.toLocaleTimeString()}.`);
            setTimeout(retry, delay);
        }
    } catch (e) {
        console.warn("Fout bij response analyseren", e);
        setTimeout(retry, 10000);
    }
}

function place(x, y, color, accessToken = defaultAccessToken) {
    socket.send(JSON.stringify({ type: "placepixel", x, y, color }));
    console.log(`Umistuji pixel na (${x}, ${y}) barva: ${color}"`);
    return fetch("https://gql-realtime-2.reddit.com/query", {
        method: "POST",
        body: JSON.stringify({
            operationName: "setPixel",
            variables: {
                input: {
                    actionName: "r/replace:set_pixel",
                    PixelMessageData: {
                        coordinate: {
                            x: x % 1000,
                            y: y % 1000,
                        },
                        colorIndex: color,
                        canvasIndex: calculateCanvasIndex(x, y),
                    },
                },
            },
            query: "mutation setPixel($input: ActInput!) {\n  act(input: $input) {\n    data {\n      ... on BasicMessage {\n        id\n        data {\n          ... on GetUserCooldownResponseMessageData {\n            nextAvailablePixelTimestamp\n            __typename\n          }\n          ... on SetPixelResponseMessageData {\n            timestamp\n            __typename\n          }\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n",
        }),
        headers: {
            origin: "https://hot-potato.reddit.com",
            referer: "https://hot-potato.reddit.com/",
            "apollographql-client-name": "mona-lisa",
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
    });
}

async function getCurrentImageUrl(index = "0") {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(
            "wss://gql-realtime-2.reddit.com/query",
            "graphql-ws",
            {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (X11; Linux x86_64; rv:98.0) Gecko/20100101 Firefox/98.0",
                    Origin: "https://hot-potato.reddit.com",
                },
            }
        );

        ws.onopen = () => {
            ws.send(
                JSON.stringify({
                    type: "connection_init",
                    payload: {
                        Authorization: `Bearer ${defaultAccessToken}`,
                    },
                })
            );

            ws.send(
                JSON.stringify({
                    id: "1",
                    type: "start",
                    payload: {
                        variables: {
                            input: {
                                channel: {
                                    teamOwner: "AFD2022",
                                    category: "CANVAS",
                                    tag: index,
                                },
                            },
                        },
                        extensions: {},
                        operationName: "replace",
                        query: "subscription replace($input: SubscribeInput!) {\n  subscribe(input: $input) {\n    id\n    ... on BasicMessage {\n      data {\n        __typename\n        ... on FullFrameMessageData {\n          __typename\n          name\n          timestamp\n        }\n      }\n      __typename\n    }\n    __typename\n  }\n}",
                    },
                })
            );
        };

        ws.onmessage = (message) => {
            const { data } = message;
            const parsed = JSON.parse(data);

            if (parsed.type === "connection_error") {
                console.error(
                    `[!!] Nelze nacist /r/place : ${parsed.payload.message}. Je pristupovy token stale platny?`
                );
            }

            if (
                !parsed.payload ||
                !parsed.payload.data ||
                !parsed.payload.data.subscribe ||
                !parsed.payload.data.subscribe.data
            ) {
                return;
            }

            ws.close();
            resolve(parsed.payload.data.subscribe.data.name + `?noCache=${Date.now() * Math.random()}`);
        };

        ws.onerror = reject;
    });
}

function getMapFromUrl(url) {
    return new Promise((resolve, reject) => {
        getPixels(url, function (err, pixels) {
            if (err) {
                console.log("Bad image path");
                reject();
                return;
            }
            console.log("got pixels", pixels.shape.slice());
            resolve(pixels);
        });
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
    return (
        "#" + ((1 << 24) + (r << 16) + (g << 8) + b)
            .toString(16)
            .slice(1)
            .toUpperCase()
    );
}

let rgbaOrderToHex = (i, rgbaOrder) => rgbToHex(rgbaOrder[i * 4], rgbaOrder[i * 4 + 1], rgbaOrder[i * 4 + 2]);
