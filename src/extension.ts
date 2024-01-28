// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import {diff, applyChange} from 'deep-diff';
require('isomorphic-fetch');


function newId() {
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
			var r = Math.random() * 16 | 0, v = c == "x" ? r : (r & 0x3 | 0x8); // eslint-disable-line
			return v.toString(16);
	});
}
const getGraph = async (id: string): Promise<any> => {
	const response = await fetch(`${httpsServer}graph/${id}/latest`);
	const graph = await response.json() as {[key: string]: any};
	return graph;
};

const getNode = async (compoundId: string): Promise<any> => {
	const graphId = compoundId.split('/')[0];
	const id = compoundId.split('/')[1];
	const graph = await getGraph(graphId);
	return graph.nodes.find((n: any) => n.id === id);
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


let httpsServer: string;
let apiKey: string;
let wssServer: string;
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

  const configuration = vscode.workspace.getConfiguration('plasticGraphEditor');
  apiKey = configuration.get('apiKey', '');
  httpsServer = configuration.get('httpsServer', '');
  wssServer = configuration.get('wssServer', '');

	const treeDataProvider = new DirectoryTreeDataProvider();
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
export function deactivate() {}

class DirectoryTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
	getTreeItem(element: vscode.TreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
		return element; // Return the element itself as its tree item
	}

	async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
		if (element) {
			if (element.contextValue === 'graph') {
				console.log('graph selected', element);
				const graph = await getGraph((element.id as string).split('#')[1]);
				return graph.nodes.map((node: any, i: number) => {
					const name = (node.properties.name || 'Unnamed') + '#' + node.id;
					const item = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.Collapsed);
					item.id = `${graph.properties.name}/${node.properties.name || 'Unnamed'}#${graph.id}/${node.id}`;
					item.contextValue = 'node';
					item.description = node.properties.description;
					return item;
				});
			}
			if (element.contextValue === 'node') {
				const compoundId = (element.id as string).split('#')[1];
				const node = getNode(compoundId);
				const vue = new vscode.TreeItem('presentation.vue', vscode.TreeItemCollapsibleState.None);
				vue.contextValue = 'vue';
				vue.id = compoundId + '/presentation.vue';
				vue.command = {
					command: 'plastic-io-graph-coder.treeItemClick',
					title: 'Handle Tree Item Click',
					arguments: [compoundId + '/presentation.vue'],
				};
				vue.tooltip = 'Vue Presentation Source Code';
				const setItem = new vscode.TreeItem('set.js', vscode.TreeItemCollapsibleState.None);
				setItem.contextValue = 'set';
				setItem.id = compoundId + '/set.js';
				setItem.tooltip = 'Set Function Source Code';
				setItem.command = {
					command: 'plastic-io-graph-coder.treeItemClick',
					title: 'Handle Tree Item Click',
					arguments: [compoundId + '/set.js'],
				};
				const dataItem = new vscode.TreeItem('data.json', vscode.TreeItemCollapsibleState.None);
				dataItem.contextValue = 'data';
				dataItem.id = compoundId + '/data.json';
				dataItem.tooltip = 'Node Data.  Arbitrary data stored on the node for use by the presentation or set functions.';
				dataItem.command = {
					command: 'plastic-io-graph-coder.treeItemClick',
					title: 'Handle Tree Item Click',
					arguments: [compoundId + '/data.json'],
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
			const toc = await getToc();
			console.log('toc', toc);
			return Object.keys(toc).filter((key) => {
				return !/\//g.test(key);
			}).map((key) => {
				const item = new vscode.TreeItem(toc[key].name, vscode.TreeItemCollapsibleState.Collapsed);
				item.contextValue = 'graph';
				item.id = `${toc[key].name}#${toc[key].id}`;
				item.tooltip = toc[key].description;
				return item;
			}) as vscode.TreeItem[];
		}
	}
}


class GraphFileSystemProvider implements vscode.FileSystemProvider {

    // Implement the onDidChangeFile event
    onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = new vscode.EventEmitter<vscode.FileChangeEvent[]>().event;

    // method to watch for file changes
    watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
        // This is just a stub, so no actual file watching logic is implemented
        return new vscode.Disposable(() => {});
    }

    // Implement method to stat a file or directory
    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
			  // return { type: vscode.FileType.File, ctime: 0,	mtime: 0, size: 0,};
				const path = uri.path.split('/');
				if (path.length === 4) {
					const node = await getNode(`${path[1]}/${path[2]}`);
					const fileName = path[3];
					const file = fileName === 'data.json'
						? node.data
						: node.template[fileName.replace(/presentation\.|\.js/, '')];
					return {
						type: vscode.FileType.File,
						ctime: 0,
						mtime: 0,
            size: JSON.stringify(file).length,
					};
				}
				if (path.length === 3) {
					const node = await getNode(`${path[1]}/${path[2]}`);
					return {
						type: vscode.FileType.Directory,
						ctime: 0,
						mtime: 0,
            size: JSON.stringify(node).length,
					};
				}
				if (path.length === 2) {
					const graph = await getGraph(`${path[1]}}`);
					return {
						type: vscode.FileType.Directory,
						ctime: 0,
						mtime: 0,
            size: JSON.stringify(graph).length,
					};
				}
				throw new Error('graphfs stat: Unknown path syntax');
    }

    // method to read directories
    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
			// return [];
			const path = uri.path.split('/');
			console.log('read directory', path.length, uri);
			if (uri.path === '/') {
				const toc = await getToc();
				const keys = Object.keys(toc);
				return keys.filter((key) => {
					return !/\//g.test(key);
				}).map((key) => {
					return [
						`${toc[key].name}#${toc[key].id}`,
						vscode.FileType.Directory,
					];
				}) as [string, vscode.FileType][];
			}
			if (path.length === 3) {
				const node = await getNode(`${path[1]}/${path[2]}`);
				return [
					['presentation.vue', vscode.FileType.File],
					['set.js', vscode.FileType.File],
					['data.json', vscode.FileType.File],
				];
			}
			if (path.length === 2) {
				const graph = await getGraph(path[1]);
				return graph.nodes.map((node: any) => {
					return [
						`${node.properties.name || 'Unnamed'}#${node.id}`,
						vscode.FileType.Directory,
					];
				});
			}
			throw new Error('graphfs readDirectory: Unknown path syntax');
    }

    // Other necessary methods like createDirectory, readFile, writeFile, etc., should also be stubbed here
    createDirectory(uri: vscode.Uri): void | Thenable<void> {
        throw new Error('Method not implemented.');
    }

  	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
			const path = uri.path.split('/');
			const node = await getNode(`${path[1]}/${path[2]}`);
			const type = uri.path.split('/')[3].replace(/presentation\.|\.jso?n?/, '');
			const encoder = new TextEncoder();
			const data = type === 'data' ? node.data : node.template[type];
			return encoder.encode(data || '');
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): Promise<void> {
        // create a diff and event and send it to the server
				const graphId = uri.path.split('/')[1];
				const nodeId = uri.path.split('/')[2];
				const type = uri.path.split('/')[3].replace(/presentation\.|\.jso?n?/, '');
				const graph = await getGraph(graphId);
				const node = graph.nodes.find((n: any) => n.id === nodeId);
				const snapshotGraph = JSON.parse(JSON.stringify(graph));
				const snapshotNode = graph.nodes.find((n: any) => n.id === nodeId);
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


