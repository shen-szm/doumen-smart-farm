export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 静态部署没有数据服务：/api/* 回退到随构建发布的快照文件，无快照时保持 404。
    if (url.pathname.startsWith("/api/") && ["GET", "HEAD"].includes(request.method)) {
      const snapshotUrl = new URL(request.url);
      snapshotUrl.pathname = `/data/${url.pathname.slice("/api/".length)}-snapshot.json`;
      snapshotUrl.search = "";
      return env.ASSETS.fetch(new Request(snapshotUrl, request));
    }

    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");

    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) {
      return response;
    }

    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};
