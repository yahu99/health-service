import http from "k6/http";
import { sleep } from "k6";

const baseUrl = __ENV.BASE_URL || "http://arch.homework";
const fallbackUserId = 2147483647;

export const options = {
    vus: Number(__ENV.VUS || 10),
    duration: __ENV.DURATION || "10m",
};

const jsonRequest = {
    headers: {
        "Content-Type": "application/json",
    },
};

function executeUserRequests(userId) {
    http.get(`${baseUrl}/user/${userId}`, {
        tags: {
            name: "GET /user/:userId",
        },
    });

    http.put(
        `${baseUrl}/user/${userId}`,
        JSON.stringify({
            firstName: "Updated",
        }),
        {
            headers: {
                "Content-Type": "application/json",
            },
            tags: {
                name: "PUT /user/:userId",
            },
        },
    );

    http.del(`${baseUrl}/user/${userId}`, null, {
        tags: {
            name: "DELETE /user/:userId",
        },
    });
}

export default function () {
    const uniqueValue = `${__VU}-${__ITER}-${Date.now()}`;

    const createResponse = http.post(
        `${baseUrl}/user`,
        JSON.stringify({
            username: `load-user-${uniqueValue}`,
            firstName: "Load",
            lastName: "Test",
            email: `load-${uniqueValue}@example.com`,
        }),
        {
            headers: {
                "Content-Type": "application/json",
            },
            tags: {
                name: "POST /user",
            },
        },
    );

    if (createResponse.status === 201) {
        const userId = createResponse.json("id");
        executeUserRequests(userId);
    } else {
        executeUserRequests(fallbackUserId);
    }

    sleep(0.5);
}