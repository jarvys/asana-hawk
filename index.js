var fs = require('fs');
var async = require('async');
var _ = require('underscore');
var Promise = require('promise');
var Asana = require('asana');

var client = Asana.Client.create().useAccessToken(process.env.ASANA_ACCESS_TOKEN);

function getWorkspace() {
    return client.users.me().then(user => {
        return _.find(user.workspaces, workspace => {
            return workspace.name === '厘米脚印';
        });
    });
}

function reduceMap(items) {
    return items.reduce((map, item) => {
        map[item.id] = item;
        return map;
    }, {});
}

function fetchStats() {
    return getWorkspace().then(workspace => {
        if (!workspace) {
            throw new Error('workspace not found');
        }

        return Promise.all([
            client.users.findByWorkspace(workspace.id).then(collection => collection.data),
            client.projects.findByWorkspace(workspace.id).then(collection => collection.data)
        ]).then(result => {
            var users = result[0];
            var projects = result[1];
            var projectMap = reduceMap(projects);
            var userMap = reduceMap(users);

            return Promise.all(users.map(user => {
                return client.tasks.findAll({
                    workspace: workspace.id,
                    assignee: user.id,
                    completed_since: 'now',
                    opt_fields: 'id,name,projects,assignee'
                }).then(collection => collection.data);
            })).then(allTasks => {
                var tasks = _.flatten(allTasks).filter(task => {
                    var projects = task.projects;
                    if (projects.length === 0) {
                        return false;
                    }

                    var projectId = task.projects[0].id;
                    var project = projectMap[projectId];
                    var assignee = userMap[task.assignee.id];
                    return project && assignee;
                }).map(task => {
                    var project = projectMap[task.projects[0].id];
                    var assignee = userMap[task.assignee.id];

                    return Object.assign({}, task, {
                        project,
                        assignee
                    });
                });

                var csvData = tasks.map(task => {
                    return [
                        task.id,
                        task.name,
                        task.assignee.id,
                        task.assignee.name,
                        task.project.id,
                        task.project.name
                    ];
                });

                csvData = [
                    ['task id', 'task name', 'assignee id', 'assignee name', 'project id', 'project name']
                ].concat(csvData);

                var content = csvData.map(row => row.join(',')).join('\n');
                fs.writeFileSync(__dirname + '/matrix.csv', content, {
                    encoding: 'utf-8'
                });
            });
        });
    });
}

var queue = async.queue((task, callback) => {
    console.log('handle task', task);
    fetchStats().then(() => {
        console.log('task done', task);
        callback(null);
    }, e => {
        console.error('task fail', e);
        callback(e);
    });
}, 1);

var taskId = 0;

setInterval(() => {
    if (queue.length() > 0) {
        return console.warn('previous task not finished');
    }

    queue.push({
        id: ++taskId
    });
}, 60 * 1000);

queue.push({
    id: ++taskId
});

var express = require('express');
var morgan = require('morgan');
var app = express();
app.use(morgan('combined'));

app.get('/matrix.csv', function(req, res) {
    if (req.query.force && queue.length() === 0) {
        console.log('force to refresh data');
        queue.push({
            id: ++taskId
        }, function(e) {
            if (e) {
                res.status(500).send('');
            } else {
                res.sendFile(__dirname + '/matrix.csv');
            }
        });
    } else {
        res.sendFile(__dirname + '/matrix.csv');
    }
});

var port = 8080;
app.listen(port, function() {
    console.log('listening on port', port);
});
