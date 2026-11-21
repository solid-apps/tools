# Tools

Set up a **tool index** in your Solid pod: your own private list of the panes and apps you want to use on
your data.

**Open it:** <https://solid-apps.github.io/tools/>

## What it does

1. You log in with your pod.
2. It reads your preferences file and tells you whether you already have a tool index.
3. If you do not, it shows the two changes it would make, and makes them when you press the button:
   - a new, empty index file beside your preferences file (`toolIndex.jsonld`, or `toolIndex.ttl` if your
     preferences file is Turtle). It is in your settings folder, so it is private to you;
   - one line added to your preferences file: `<your WebID> tools:toolIndex <the new file>`. The rest of the
     file is kept as it is.
4. It gives you a link to open the index in a dashboard, where you add panes and apps.

It writes nothing before you press the button. To undo it, delete the new file and remove the one line.

## What a tool index is

A document that lists the panes and apps a person wants for each kind of resource, in the
[PodOS tools vocabulary](https://pod-os.org/vocab/tools). The [SolidOS Browser](https://solidos.org/docs/browser/)
reads it when you log in: the panes in it are loaded, and the apps are offered as "Open with" links. The
dashboard that manages it is the [tool index pane](https://github.com/solid-panes/tool-index).

## How it is built

- `index.html`: the page. One file, no build. Login is [xlogin](https://www.npmjs.com/package/xlogin).
- `tools.js`: the logic, with no page in it: `lookUp`, `plan`, `create`. It is given a WebID, a fetch that
  carries the login, and rdflib for reading.

The link is added by editing the preferences file as text in its own format (a node appended to the JSON-LD
graph, or a line appended to the Turtle), and saved only if the file has not changed since it was read.

## Licence

MIT, copyright Melvin Carvalho.
