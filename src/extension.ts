// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import {diff, applyChange} from 'deep-diff';
import WebSocket from 'ws';
require('isomorphic-fetch');


let webSocket: WebSocket;
let httpsServer: string;
let apiKey: string;
let wssServer: string;
let closeWebSocket = false;
let localToc: {[key: string]: any} = {};
let treeDataProvider: DirectoryTreeDataProvider;
const subscriptions: string[] = [];
const treeItems: {[key: string]: vscode.TreeItem} = {};
const fileChangeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();



function newId() {
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
			var r = Math.random() * 16 | 0, v = c == "x" ? r : (r & 0x3 | 0x8); // eslint-disable-line
			return v.toString(16);
	});
}

function getTreeItemIdsToRefresh(changeMessage: any, toc: any): string[] {
	const idsToRefresh = new Set<string>();

	// Iterate over each change message
	for (const change of changeMessage.response) {
			const graphId = change.graphId;
			let shouldRefreshGraph = false;  // Flag to determine if the graph itself should be refreshed

			// Check if this graphId is in the TOC
			if (toc[graphId]) {
					// Iterate over the changes
					for (const c of change.changes) {
							const lastField: string = c.path[c.path.length - 1];
							// Check if the change is for a version field at the graph level
							if (c.path.length === 1 && c.path[0] === 'version') {
									// Ignore graph version changes
									continue;
							} else if (c.path.length === 1) {
									// If there are other changes, mark the graph for refresh
									shouldRefreshGraph = true;
							}

							// Check if the change is for a version field in a node
							if (lastField === 'version') {
									// Ignore node version changes
									continue;
							}
							// node name changed
							if (lastField === 'name' && c.path[0] === 'nodes' && typeof c.path[1] === 'number') {

							}
							// graph name changed
							if (lastField === 'name' && c.path.length === 1) {

							}
							// Process node-specific changes
							if (c.path[0] === 'nodes' && typeof c.path[1] === 'number') {
									const nodeIndex = c.path[1];
									const id = Object.keys(treeItems).find((key: string) => {
										const reg = new RegExp(graphId + '/' + nodeIndex);
										return reg.test(key);
									}) as string;
									idsToRefresh.add(id);
									if (/vue|set|data/.test(lastField)) {
										const fileName: string | undefined = {
											vue: 'presentation.vue',
											set: 'set.js',
											data: 'data.json',
										}[lastField];
										setTimeout(async () => {
											const graph = await getGraph(graphId);

											  const uri = vscode.Uri.parse(`graphfs:/${localToc[graphId].name}/${graph.nodes[nodeIndex].properties.name}/${fileName}#${graphId}/${nodeIndex}`);
												// ``;
												console.log('fire', uri);
											  fileChangeEmitter.fire([{
													type: vscode.FileChangeType.Changed,
													uri,
											  }]);
										}, 0);
									}
							}
					}

					// If the graph should be refreshed (other than version changes), add it to the list
					if (shouldRefreshGraph) {
							const treeItemId = `${toc[graphId].name}#${graphId}`;
							idsToRefresh.add(treeItemId);
					}
			}
	}

	return Array.from(idsToRefresh);
}



const subscribe = (channelId: string) => {
	webSocket.send(JSON.stringify({
		action: "subscribe",
		channelId,
	}));
	if (subscriptions.indexOf(channelId) === -1) {
		subscriptions.push(channelId);
	}
}
const getGraph = async (id: string): Promise<any> => {
	const response = await fetch(`${httpsServer}graph/${id}/latest`);
	const graph = await response.json() as {[key: string]: any};
	const channelId = "graph-event-" + graph.id;
	if (subscriptions.indexOf(channelId) === -1) {
		subscribe(channelId);
	}
	return graph;
};

const getNode = async (compoundId: string): Promise<any> => {
	const graphId = compoundId.split('/')[0];
	const index = compoundId.split('/')[1];
	const graph = await getGraph(graphId);
	return graph.nodes[index];
};

const getToc = async (): Promise<any> => {
	const response = await fetch(`${httpsServer}toc.json`);
	return await response.json() as {[key: string]: any};
};

const getFileScheme = (path: string): string => {
	const baseType = path.split('/')[3];
	return {
		vue: 'vue',
		data: 'json',
		set: 'javascript',
	}[baseType] || 'javascript';
};

const initToc = async () => {
	localToc = await getToc();
};


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

  const configuration = vscode.workspace.getConfiguration('plasticGraphEditor');
  apiKey = configuration.get('apiKey', '');
  httpsServer = configuration.get('httpsServer', '');
  wssServer = configuration.get('wssServer', '');

	initToc();

	const initWebSocket = () => {
		webSocket = new WebSocket(wssServer);
		webSocket.on('message', async (data) => {
			const msg = JSON.parse(data.toString());
			console.log('webSocket message', msg);

			if (msg.channelId === 'toc.json') {
				console.log("Refreshing TOC", msg);
				const newToc = msg.response.toc;
				const newTocKeys = Object.keys(newToc).filter(key => !/\//g.test(key));
				const oldTocKeys = Object.keys(localToc).filter(key => !/\//g.test(key));
				if (diff(newTocKeys, oldTocKeys)) {
					localToc = newToc;
					// Refresh the tree view to reflect changes
					treeDataProvider.refresh();
				}
		  }

			if (msg.channelId) {
				if (msg.response && msg.response.type === 'toc') {
					return;
				}
				const changeIds = getTreeItemIdsToRefresh(msg, localToc);
				changeIds.forEach((key) => {
					console.log("refreshing key", key, treeItems[key]);
					treeDataProvider.refresh(treeItems[key]);
				});

			}

		});

		webSocket.on('open', () => {
				console.log('WebSocket connection opened');
				// Perform any setup or send any initial messages if required
				webSocket.send(JSON.stringify({
					action: "subscribe",
					channelId: "toc.json",
				}));
				subscriptions.forEach((channelId) => {
					webSocket.send(JSON.stringify({
						action: "subscribe",
						channelId,
					}));
				})
		});

		webSocket.on('error', (error) => {
				console.error('WebSocket error:', error);
		});

		webSocket.on('close', () => {
				console.log('WebSocket connection closed');
				if (closeWebSocket) { return; }
				initWebSocket();
		});
	};
  initWebSocket();


	treeDataProvider = new DirectoryTreeDataProvider();

	vscode.window.createTreeView('plastic-io-graph-coder.viewGraphs', { treeDataProvider });

	context.subscriptions.push(vscode.workspace.registerFileSystemProvider('graphfs', new GraphFileSystemProvider(), { isCaseSensitive: true }));
	let disposable2 = vscode.commands.registerCommand('plastic-io-graph-coder.openGraph', () => {
			const uri = vscode.Uri.parse('graphfs:/path/to/your/file.txt');
			vscode.workspace.openTextDocument(uri)
					.then(doc => vscode.window.showTextDocument(doc));
	});

	let disposable3 = vscode.commands.registerCommand('plastic-io-graph-coder.treeItemClick', (arg) => {
		const uri = vscode.Uri.parse(`graphfs:/${arg}`);
		vscode.workspace.openTextDocument(uri)
			.then(doc => vscode.window.showTextDocument(doc));
	});

	context.subscriptions.push(disposable2);
	context.subscriptions.push(disposable3);

}

// This method is called when your extension is deactivated
export function deactivate() {

	closeWebSocket = true;
	webSocket.close();

}

class DirectoryTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {

	private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

	refresh(item?: vscode.TreeItem): void {
		this._onDidChangeTreeData.fire(item);
	}

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
		return element; // Return the element itself as its tree item
	}

	async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
		if (element) {
			if (element.contextValue === 'graph') {
				console.log('graph selected', element);
				const graph = await getGraph((element.id as string).split('#')[1]);
				return graph.nodes.map((node: any, i: number) => {
					const name = (node.properties.name || 'Unnamed');
					const item = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.Collapsed);
					item.id = `${graph.properties.name}/${node.properties.name || 'Unnamed'}#${graph.id}/${i}`;
					item.contextValue = 'node';
					item.description = node.properties.description;
					treeItems[item.id] = item;
					return item;
				});
			}
			if (element.contextValue === 'node') {
				console.log('vue', (element.id as string).replace('#', '/presentation.vue#'));
				console.log('set', (element.id as string).replace('#', '/set.js#'));
				console.log('data', (element.id as string).replace('#', '/data.json#'));
				const vue = new vscode.TreeItem('presentation.vue', vscode.TreeItemCollapsibleState.None);
				vue.contextValue = 'vue';
				vue.id = (element.id as string).replace('#', '/presentation.vue#');
				treeItems[vue.id] = vue;
				vue.command = {
					command: 'plastic-io-graph-coder.treeItemClick',
					title: 'Handle Tree Item Click',
					arguments: [(element.id as string).replace('#', '/presentation.vue#')],
				};
				vue.tooltip = 'Vue Presentation Source Code';
				const setItem = new vscode.TreeItem('set.js', vscode.TreeItemCollapsibleState.None);
				setItem.contextValue = 'set';
				setItem.id = (element.id as string).replace('#', '/set.js#');
				treeItems[setItem.id] = setItem;
				setItem.tooltip = 'Set Function Source Code';
				setItem.command = {
					command: 'plastic-io-graph-coder.treeItemClick',
					title: 'Handle Tree Item Click',
					arguments: [(element.id as string).replace('#', '/set.js#')],
				};
				const dataItem = new vscode.TreeItem('data.json', vscode.TreeItemCollapsibleState.None);
				dataItem.contextValue = 'data';
				dataItem.id = (element.id as string).replace('#', '/data.json#');
				treeItems[dataItem.id] = dataItem;
				dataItem.tooltip = 'Node Data.  Arbitrary data stored on the node for use by the presentation or set functions.';
				dataItem.command = {
					command: 'plastic-io-graph-coder.treeItemClick',
					title: 'Handle Tree Item Click',
					arguments: [(element.id as string).replace('#', '/data.json#')],
				};
				return [
					vue,
					setItem,
					dataItem,
				];
			}
			return [];
		} else {
			// TOP LEVEL
			console.log('fetching plastic-io TOC: ' + httpsServer + 'toc.json');
			await initToc();
			console.log('toc', localToc);
			return Object.keys(localToc).filter((key) => {
				return !/\//g.test(key);
			}).map((key) => {
				const item = new vscode.TreeItem(localToc[key].name, vscode.TreeItemCollapsibleState.Collapsed);
				item.contextValue = 'graph';
				item.id = `${localToc[key].name}#${localToc[key].id}`;
				treeItems[item.id] = item;
				item.tooltip = localToc[key].description;
				return item;
			}).sort((a: any, b: any) => {
				return a.id.localeCompare(b.id);
			}) as vscode.TreeItem[];
		}
	}
}


class GraphFileSystemProvider implements vscode.FileSystemProvider {

    // Implement the onDidChangeFile event
    onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = fileChangeEmitter.event;

    // method to watch for file changes
    watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
        console.log('watch', uri.path, uri.fragment);
				// This is just a stub, so no actual file watching logic is implemented
        return new vscode.Disposable(() => {});
    }

    // Implement method to stat a file or directory
    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
				console.log('stat', uri.path, uri.fragment);
			  //return { type: vscode.FileType.File, ctime: 0,	mtime: 0, size: 0,};
				const graphId = uri.fragment.split('/')[0];
				const nodeIndex = uri.fragment.split('/')[1];

				const graph = await getGraph(graphId);
				const node = graph.nodes[nodeIndex];
				if (uri.path === '/') {
					return { type: vscode.FileType.Directory, ctime: 0,	mtime: 0, size: 0,};
				}

				if (uri.path.split('/').length === 2) {
					return {
						type: vscode.FileType.Directory,
						ctime: graph.properties.createdOn,
						mtime: graph.properties.lastUpdate,
            size: JSON.stringify(graph).length,
					};
				}

				if (uri.path.split('/').length === 3) {
					return {
						type: vscode.FileType.Directory,
						ctime: node.properties.createdOn,
						mtime: node.properties.lastUpdate,
            size: JSON.stringify(node).length,
					};
				}

				if (uri.path.split('/').length === 4) {
					return {
						type: vscode.FileType.File,
						ctime: node.properties.createdOn,
						mtime: node.properties.lastUpdate,
            size: JSON.stringify(node).length,
					};
				}

				throw new Error('graphfs stat: Unknown path syntax');
    }

    // method to read directories
    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
			console.log('readDirectory', uri);
			const fragment = uri.path.split('#')[1] || uri.fragment;
			if (uri.path === '/') {
				initToc();
				const keys = Object.keys(localToc);
				return keys.filter((key) => {
					return !/\//g.test(key);
				}).map((key) => {
					return [
						`${localToc[key].name}#${localToc[key].id}`,
						vscode.FileType.Directory,
					];
				}) as [string, vscode.FileType][];
			}


			if (uri.path.split('/').length === 2) {
				const graph = await getGraph(fragment.split('/')[0]);
				return graph.nodes.map((node: any, i: number) => {
					return [
						`${node.properties.name || 'Unnamed'}`,
						vscode.FileType.Directory,
					];
				});
			}

			if (uri.path.split('/').length === 3) {
				console.log('length 3', uri);
				return [
					['presentation.vue', vscode.FileType.File],
					['set.js', vscode.FileType.File],
					['data.json', vscode.FileType.File],
				];
			}
			throw new Error('graphfs readDirectory: Unknown path syntax');
    }

    // Other necessary methods like createDirectory, readFile, writeFile, etc., should also be stubbed here
    createDirectory(uri: vscode.Uri): void | Thenable<void> {
        throw new Error('Method not implemented.');
    }

  	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
			console.log('read file', uri);
			const path = uri.fragment.split('/');
			const node = await getNode(`${path[0]}/${path[1]}`);
			const type = uri.path.split('/')[3].replace(/presentation\.|\.jso?n?/, '');
			subscribe("graph-event-" + node.graphId);
			const encoder = new TextEncoder();
			const data = type === 'data' ? node.data : node.template[type];
			return encoder.encode(data || '');
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): Promise<void> {
        // create a diff and event and send it to the server
				const path = uri.fragment.split('/');
				const type = uri.path.split('/')[3].replace(/presentation\.|\.jso?n?/, '');
				const graphId = uri.fragment.split('/')[0];
				const nodeIndex = uri.fragment.split('/')[1];
				const graph = await getGraph(graphId);
				const node = graph.nodes[nodeIndex];
				const snapshotGraph = JSON.parse(JSON.stringify(graph));
				const snapshotNode = graph.nodes.find((n: any) => n.id === node.id);
				if (type === 'data') {
					snapshotNode.data = content.toString();
				} else {
					snapshotNode.template[type] = content.toString();
				}
        const changes = diff(snapshotGraph, graph);
        if (changes) {
            const event = {
                id: newId(),
                changes,
                version: graph.version + 1,
								graphId,
                description: 'Updated ' + type,
            };
						console.log('posting event', event);
            fetch(httpsServer + 'addEvent', {
							method: 'POST',
							body: JSON.stringify({
								event,
							}),
						});
        }
    }

    // Implement method to delete a file or directory
    delete(uri: vscode.Uri, options: { recursive: boolean }): void | Thenable<void> {
				// Here you would add logic to handle file or directory deletion.
				// For now, this is just a to show where your delete logic would go.
				console.log(`Deleting uri: ${uri.toString()} with options: ${JSON.stringify(options)}`);
				// If your API requires asynchronous calls, you would return a promise here.
		}

		// Implement method to rename or move a file or directory
		rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void | Thenable<void> {
				// Here you would add logic to rename or move a file or directory.
				// This logs the action and shows where to place your rename logic.
				console.log(`Renaming or moving from ${oldUri.toString()} to ${newUri.toString()} with options: ${JSON.stringify(options)}`);
				// Similar to delete, handle asynchronous logic with a promise if needed.
		}
    // Add stubs for all other methods required by the interface...
}


